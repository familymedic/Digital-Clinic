-- Weekly slot planner for audio/video consultations (2026-10-13).
--
-- WHAT: a doctor saves ONE weekly plan (which weekdays, up to 2 time
-- windows, 3/4/5 minutes per slot). The database cuts each window into
-- slots, creates the next 7 days of them in a single all-or-nothing step,
-- and keeps the plan so "Extend another week" can repeat it.
--
-- ADDITIVE: no existing table/column/policy is changed. Slots already in
-- the database keep working exactly as before (they are marked 'manual').
-- Needs 0071 + 0072 to be run first (patients' slot lists + 30-minute hold).
--
--  1. doctor_availability_slots.source ('manual' | 'plan'): lets the
--     planner replace ITS OWN empty slots when the plan changes, and never
--     touch slots a doctor added by hand or that already have a booking.
--  2. doctor_slot_plans: one row per doctor (days, minutes, windows,
--     covered_until). Written only by the functions below.
--  3. Limits that replace the old 200-per-save browser check, enforced
--     HERE so no screen bug or second tab can get around them:
--        planner: at most 100 slots per day (both windows together)
--        hard ceiling: 120 slots per doctor per day (leaves room to add a
--        few extra by hand), and no second slot at the exact same time.
--  4. apply_weekly_plan / extend_weekly_plan / list_my_slots /
--     cleanup_my_past_slots: signed-in doctors only, each acts only on the
--     caller's own slots.
--  5. Nightly clean-up (pg_cron, same pattern as 0066): past slots that
--     nobody ever booked are deleted. Booked/cancelled ones are kept.
--
-- ROLLBACK: ROLLBACK-0073.sql shipped with this migration.

alter table public.doctor_availability_slots
  add column if not exists source text not null default 'manual';

do $$
begin
  alter table public.doctor_availability_slots
    add constraint doctor_availability_slots_source_check check (source in ('manual', 'plan'));
exception when duplicate_object then null;
end $$;

-- Two planner runs (double click, two tabs) can never create the same plan slot twice.
create unique index if not exists doctor_availability_slots_plan_unique
  on public.doctor_availability_slots (doctor_id, start_time) where source = 'plan';

create table if not exists public.doctor_slot_plans (
  doctor_id uuid primary key references public.doctor_profiles (id) on delete cascade,
  days int[] not null,
  slot_minutes int not null check (slot_minutes in (3, 4, 5)),
  windows jsonb not null,
  covered_until date not null,
  updated_at timestamptz not null default now()
);

alter table public.doctor_slot_plans enable row level security;
drop policy if exists "Doctors can view their own slot plan" on public.doctor_slot_plans;
create policy "Doctors can view their own slot plan"
  on public.doctor_slot_plans for select
  using (doctor_id = auth.uid());
-- No insert/update/delete policy: only the functions below (security definer) write here.

-- ---- hard limits on every new slot (planner, manual add, anything) ----
create or replace function public.enforce_slot_daily_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_n int;
begin
  if exists (
    select 1 from public.doctor_availability_slots s
    where s.doctor_id = new.doctor_id and s.start_time = new.start_time
  ) then
    raise exception 'You already have a time slot at that exact time.';
  end if;

  v_day := (new.start_time at time zone 'Asia/Karachi')::date;
  select count(*) into v_n
  from public.doctor_availability_slots s
  where s.doctor_id = new.doctor_id
    and s.start_time >= (v_day::timestamp at time zone 'Asia/Karachi')
    and s.start_time < ((v_day + 1)::timestamp at time zone 'Asia/Karachi');
  if v_n >= 120 then
    raise exception 'That day already has 120 time slots, which is the most allowed. Please remove some before adding more.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_slot_enforce_daily_ceiling on public.doctor_availability_slots;
create trigger on_slot_enforce_daily_ceiling
  before insert on public.doctor_availability_slots
  for each row execute function public.enforce_slot_daily_ceiling();

-- ---- plan checking and slot-time generation (no side effects) ----
create or replace function public.validate_slot_plan(p_days int[], p_minutes int, p_windows jsonb)
returns void
language plpgsql
immutable
as $$
declare
  w jsonb;
  v_n int;
  v_total int := 0;
  v_start int;
  v_end int;
  v_prev_end int := -1;
  v_hh int;
begin
  if p_days is null or cardinality(p_days) < 1 or cardinality(p_days) > 7
     or exists (select 1 from unnest(p_days) d where d < 1 or d > 7)
     or (select count(distinct d) from unnest(p_days) d) <> cardinality(p_days) then
    raise exception 'Please choose at least one day of the week.';
  end if;
  if p_minutes is null or p_minutes not in (3, 4, 5) then
    raise exception 'Each slot must be 3, 4 or 5 minutes.';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) < 1 or jsonb_array_length(p_windows) > 2 then
    raise exception 'Please set one or two time windows.';
  end if;

  -- windows are checked in the order given; the second must start after the first ends
  for w in select * from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) <> 'object' or (w->>'start') is null or (w->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'A time window has an invalid start time.';
    end if;
    if (w->>'count') is null or (w->>'count') !~ '^[0-9]{1,4}$' then
      raise exception 'A time window has an invalid number of slots.';
    end if;
    v_n := (w->>'count')::int;
    if v_n < 1 or v_n > 100 then
      raise exception 'A time window can hold 1 to 100 slots.';
    end if;
    v_hh := split_part(w->>'start', ':', 1)::int;
    v_start := v_hh * 60 + split_part(w->>'start', ':', 2)::int;
    v_end := v_start + v_n * p_minutes;
    if v_end > 1440 then
      raise exception 'A time window cannot run past midnight.';
    end if;
    if v_start < v_prev_end then
      raise exception 'The two time windows overlap. The second must start after the first ends.';
    end if;
    v_prev_end := v_end;
    v_total := v_total + v_n;
  end loop;
  if v_total > 100 then
    raise exception 'That is % slots in a day. The most is 100 per day (both windows together).', v_total;
  end if;
end;
$$;

create or replace function public.plan_slot_times(
  p_days int[], p_minutes int, p_windows jsonb, p_from date, p_to date
)
returns table (start_time timestamptz)
language sql
stable
as $$
  select (d + (w->>'start')::time + (g * p_minutes) * interval '1 minute') at time zone 'Asia/Karachi'
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  cross join jsonb_array_elements(p_windows) w
  cross join lateral generate_series(0, (w->>'count')::int - 1) g
  where extract(isodow from d)::int = any (p_days);
$$;

-- ---- save the plan and (re)create the next 7 days ----
create or replace function public.apply_weekly_plan(p_days int[], p_minutes int, p_windows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_prev date;
  v_to date;
  v_desired timestamptz[];
  v_created int := 0;
  v_removed int := 0;
  v_kept int := 0;
begin
  if v_doc is null then
    raise exception 'Please log in again.';
  end if;
  if not exists (select 1 from public.doctor_profiles where id = v_doc) then
    raise exception 'Only doctors can set a schedule.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slotplan:' || v_doc::text, 0));

  perform public.validate_slot_plan(p_days, p_minutes, p_windows);

  select covered_until into v_prev from public.doctor_slot_plans where doctor_id = v_doc;
  v_to := greatest(coalesce(v_prev, v_today), v_today + 6);

  select coalesce(array_agg(distinct t.start_time), '{}'::timestamptz[]) into v_desired
  from public.plan_slot_times(p_days, p_minutes, p_windows, v_today, v_to) t
  where t.start_time > now();

  -- 1. Remove the planner's own future slots that the new plan no longer wants,
  --    but only if nobody ever booked them (a booking, paid or not, keeps the slot).
  --    (A slot a patient is booking at this very moment is row-locked by the booking
  --    check, so it is skipped here instead of being deleted underneath them.)
  with doomed as (
    select s.id from public.doctor_availability_slots s
    where s.doctor_id = v_doc
      and s.source = 'plan'
      and s.start_time > now()
      and s.start_time < ((v_to + 1)::timestamp at time zone 'Asia/Karachi')
      and not (s.start_time = any (v_desired))
      and not exists (select 1 from public.consultations c where c.slot_id = s.id)
    for update skip locked
  ), gone as (
    delete from public.doctor_availability_slots s
    using doomed d
    where s.id = d.id
    returning 1
  )
  select count(*) into v_removed from gone;

  select count(*) into v_kept
  from public.doctor_availability_slots s
  where s.doctor_id = v_doc
    and s.source = 'plan'
    and s.start_time > now()
    and s.start_time < ((v_to + 1)::timestamp at time zone 'Asia/Karachi')
    and not (s.start_time = any (v_desired));

  -- 2. Add what is missing (skipping any time the doctor already has a slot at).
  with added as (
    insert into public.doctor_availability_slots (doctor_id, start_time, capacity, source)
    select v_doc, t, 1, 'plan'
    from unnest(v_desired) t
    where not exists (
      select 1 from public.doctor_availability_slots s where s.doctor_id = v_doc and s.start_time = t
    )
    returning 1
  )
  select count(*) into v_created from added;

  insert into public.doctor_slot_plans (doctor_id, days, slot_minutes, windows, covered_until, updated_at)
  values (v_doc, p_days, p_minutes, p_windows, v_to, now())
  on conflict (doctor_id) do update
    set days = excluded.days,
        slot_minutes = excluded.slot_minutes,
        windows = excluded.windows,
        covered_until = excluded.covered_until,
        updated_at = now();

  return jsonb_build_object(
    'created', v_created,
    'removed', v_removed,
    'kept_with_bookings', v_kept,
    'covered_until', v_to
  );
end;
$$;

-- ---- "Extend another week": repeat the saved plan for the next 7 days ----
create or replace function public.extend_weekly_plan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_plan public.doctor_slot_plans%rowtype;
  v_from date;
  v_to date;
  v_created int := 0;
begin
  if v_doc is null then
    raise exception 'Please log in again.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slotplan:' || v_doc::text, 0));

  select * into v_plan from public.doctor_slot_plans where doctor_id = v_doc;
  if not found then
    raise exception 'You have not saved a weekly plan yet.';
  end if;
  -- Only in the last 2 days of the schedule (or after it has ended). This also
  -- makes a double click harmless: the second call finds the week already extended.
  if v_plan.covered_until > v_today + 1 then
    raise exception 'Your schedule already runs until %. You can extend it in its last 2 days.', to_char(v_plan.covered_until, 'DD Mon');
  end if;

  v_from := greatest(v_plan.covered_until + 1, v_today);
  v_to := v_from + 6;

  with added as (
    insert into public.doctor_availability_slots (doctor_id, start_time, capacity, source)
    select v_doc, t.start_time, 1, 'plan'
    from public.plan_slot_times(v_plan.days, v_plan.slot_minutes, v_plan.windows, v_from, v_to) t
    where t.start_time > now()
      and not exists (
        select 1 from public.doctor_availability_slots s where s.doctor_id = v_doc and s.start_time = t.start_time
      )
    returning 1
  )
  select count(*) into v_created from added;

  update public.doctor_slot_plans set covered_until = v_to, updated_at = now() where doctor_id = v_doc;

  return jsonb_build_object('created', v_created, 'covered_until', v_to);
end;
$$;

-- ---- the doctor's own slots in a window, with booking counts (replaces loading everything) ----
create or replace function public.list_my_slots(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  start_time timestamptz,
  capacity int,
  source text,
  booked int,
  has_bookings boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.start_time,
    s.capacity,
    s.source,
    (select count(*)::int from public.consultations c
       where c.slot_id = s.id
         and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until)) as booked,
    exists (select 1 from public.consultations c where c.slot_id = s.id) as has_bookings
  from public.doctor_availability_slots s
  where s.doctor_id = auth.uid()
    and s.start_time >= p_from
    and s.start_time < p_to
  order by s.start_time asc
  limit 1500;
$$;

-- ---- remove my own past slots nobody ever booked ----
create or replace function public.cleanup_my_past_slots()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    return 0;
  end if;
  with gone as (
    delete from public.doctor_availability_slots s
    where s.doctor_id = auth.uid()
      and s.start_time < now() - interval '1 day'
      and not exists (select 1 from public.consultations c where c.slot_id = s.id)
    returning 1
  )
  select count(*) into v_n from gone;
  return v_n;
end;
$$;

-- Signed-in doctors only (Postgres grants EXECUTE to everyone by default).
revoke execute on function public.apply_weekly_plan(int[], int, jsonb) from public, anon;
revoke execute on function public.extend_weekly_plan() from public, anon;
revoke execute on function public.list_my_slots(timestamptz, timestamptz) from public, anon;
revoke execute on function public.cleanup_my_past_slots() from public, anon;
grant execute on function public.apply_weekly_plan(int[], int, jsonb) to authenticated;
grant execute on function public.extend_weekly_plan() to authenticated;
grant execute on function public.list_my_slots(timestamptz, timestamptz) to authenticated;
grant execute on function public.cleanup_my_past_slots() to authenticated;

-- Nightly clean-up for every doctor (04:15 Pakistan time). If pg_cron isn't
-- available the page-open clean-up above still keeps things tidy.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup-past-empty-slots';
  perform cron.schedule(
    'cleanup-past-empty-slots',
    '15 23 * * *',
    $job$delete from public.doctor_availability_slots s
         where s.start_time < now() - interval '1 day'
           and not exists (select 1 from public.consultations c where c.slot_id = s.id)$job$
  );
exception when others then
  raise notice 'pg_cron not available (%): clean-up will run when doctors open their availability page', sqlerrm;
end
$$;
