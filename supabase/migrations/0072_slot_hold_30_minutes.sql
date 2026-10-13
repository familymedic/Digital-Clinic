-- A booking holds its time slot for 30 minutes while unpaid (2026-10-13).
--
-- WHY: enforce_slot_capacity (0021) and the open-slot lists counted EVERY
-- consultation pointing at a slot, whatever its status. A patient who
-- picked a time and never paid, or whose booking was cancelled, kept that
-- time blocked for everyone else, forever. With short (3-5 minute) slots
-- that would quickly lock a doctor's schedule.
--
-- THE RULE (one definition, consultation_holds_slot below):
--   submitted / completed ........ always holds the slot (paid)
--   pending_payment .............. holds it for 30 minutes (from booking, or
--                                  from the moment the patient restarts payment)
--   cancelled / expired unpaid ... holds nothing
--
-- WHAT THIS CHANGES (additive; no table/column is removed):
--  1. consultations.slot_hold_until (nullable): when a patient restarts
--     payment, renew_slot_hold() re-checks the slot is still free and
--     extends the hold 30 minutes. Patients cannot write this column
--     (column-level grants, 0014), only the server can.
--  2. consultation_holds_slot(): the single place that says whether a
--     booking holds its slot.
--  3. enforce_slot_capacity() (the booking-time check) and all four
--     "which slots are open" queries use that rule. The row lock that
--     stops two people taking the last spot at once is unchanged.
--  4. slot_conflict_after_payment(): if a payment lands AFTER its hold
--     ran out and the time was meanwhile taken, it records the problem
--     (payment_webhook_issues) and sends the admin a push, so nobody is
--     silently double-booked. Money is never refused or lost.
--  Supersedes the function bodies from 0071; safe to run with or without 0071.
--
-- ROLLBACK (restores the old "everything counts" behaviour exactly):
--   see ROLLBACK-0072.sql shipped with this migration.

alter table public.consultations
  add column if not exists slot_hold_until timestamptz;

-- Indexes from 0071 (harmless if already there).
create index if not exists doctor_availability_slots_doctor_start_idx
  on public.doctor_availability_slots (doctor_id, start_time);
create index if not exists doctor_availability_slots_start_idx
  on public.doctor_availability_slots (start_time);
create index if not exists consultations_slot_id_idx
  on public.consultations (slot_id) where slot_id is not null;

create or replace function public.consultation_holds_slot(
  p_status text,
  p_created_at timestamptz,
  p_hold_until timestamptz
)
returns boolean
language sql
stable
as $$
  select p_status in ('submitted', 'completed')
      or (
        p_status = 'pending_payment'
        and coalesce(p_hold_until, p_created_at + interval '30 minutes') > now()
      );
$$;

create or replace function public.enforce_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_capacity int;
  slot_doctor uuid;
  current_bookings int;
begin
  if new.slot_id is null then
    return new;
  end if;

  select capacity, doctor_id into slot_capacity, slot_doctor
  from public.doctor_availability_slots
  where id = new.slot_id
  for update;

  if slot_capacity is null then
    raise exception 'Selected time slot no longer exists.';
  end if;

  if slot_doctor is distinct from new.doctor_id then
    raise exception 'Selected time slot does not belong to the assigned doctor.';
  end if;

  select count(*) into current_bookings
  from public.consultations c
  where c.slot_id = new.slot_id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until);

  if current_bookings >= slot_capacity then
    raise exception 'Selected time slot is already full.';
  end if;

  return new;
end;
$$;

-- Old all-doctors list (still used as the fallback by the app).
create or replace function public.list_open_slots()
returns table (
  id uuid,
  doctor_id uuid,
  start_time timestamptz,
  capacity int,
  remaining int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.doctor_id,
    s.start_time,
    s.capacity,
    (s.capacity - count(c.id))::int as remaining
  from public.doctor_availability_slots s
  left join public.consultations c on c.slot_id = s.id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until)
  where s.start_time > now()
  group by s.id, s.doctor_id, s.start_time, s.capacity
  having s.capacity - count(c.id) > 0
  order by s.start_time asc;
$$;

-- Called by the payment route (service role only) when a patient restarts
-- payment on an unpaid booking. Returns true and extends the hold if the
-- time is still free for this booking, false if someone else has taken it.
create or replace function public.renew_slot_hold(p_consultation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
  v_status text;
  v_cap int;
  v_others int;
begin
  select slot_id into v_slot from public.consultations where id = p_consultation_id;
  if v_slot is null then
    return true; -- text consultation: no time slot to hold
  end if;

  -- Same lock the booking trigger takes, so a renewal and a new booking
  -- can never both think the last spot is free.
  select capacity into v_cap
  from public.doctor_availability_slots where id = v_slot for update;
  if v_cap is null then
    return false;
  end if;

  select status into v_status from public.consultations where id = p_consultation_id for update;
  if v_status is distinct from 'pending_payment' then
    return true; -- already paid / nothing to hold
  end if;

  select count(*) into v_others
  from public.consultations c
  where c.slot_id = v_slot
    and c.id <> p_consultation_id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until);

  if v_others >= v_cap then
    return false;
  end if;

  update public.consultations
  set slot_hold_until = now() + interval '30 minutes'
  where id = p_consultation_id;
  return true;
end;
$$;
revoke execute on function public.renew_slot_hold(uuid) from public, anon, authenticated;
grant execute on function public.renew_slot_hold(uuid) to service_role;

-- Called by the payment-settlement code right after a payment succeeds.
-- True = the paid booking's time now has more bookings than spots (the
-- hold ran out before payment landed and the time was taken meanwhile).
-- In that case it logs the problem and pushes the admin; it never
-- changes or refuses the payment, and any failure here is swallowed.
create or replace function public.slot_conflict_after_payment(p_consultation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
  v_cap int;
  v_holders int;
  v_secret text;
  v_site text;
begin
  select slot_id into v_slot from public.consultations where id = p_consultation_id;
  if v_slot is null then
    return false;
  end if;

  select capacity into v_cap from public.doctor_availability_slots where id = v_slot;
  select count(*) into v_holders
  from public.consultations c
  where c.slot_id = v_slot
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until);

  if v_cap is null or v_holders <= v_cap then
    return false;
  end if;

  begin
    insert into public.payment_webhook_issues (payment_id, reason, raw_payload)
    values (
      null,
      'Time slot double-booked after a late payment (consultation ' || p_consultation_id::text
        || '). Please contact the patient to choose another time, or refund.',
      jsonb_build_object('consultation_id', p_consultation_id, 'slot_id', v_slot)
    );
  exception when others then
    raise warning 'slot_conflict_after_payment: could not log issue: %', sqlerrm;
  end;

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    select decrypted_secret into v_site from vault.decrypted_secrets where name = 'site_base_url' limit 1;
    if coalesce(v_secret, '') <> '' and coalesce(v_site, '') <> '' then
      perform net.http_post(
        url := rtrim(v_site, '/') || '/api/push/send',
        headers := jsonb_build_object('x-internal-secret', v_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'broadcastRole', 'admin',
          'title', 'Time slot double-booked',
          'body', 'A patient paid after their reserved time ran out and the time was taken. Please contact them.',
          'url', '/admin/refunds'
        )
      );
    end if;
  exception when others then
    raise warning 'slot_conflict_after_payment: push failed: %', sqlerrm;
  end;

  return true;
end;
$$;
revoke execute on function public.slot_conflict_after_payment(uuid) from public, anon, authenticated;
grant execute on function public.slot_conflict_after_payment(uuid) to service_role;

create or replace function public.list_doctor_open_slots(
  p_doctor_id uuid,
  p_from timestamptz default now(),
  p_to timestamptz default now() + interval '7 days'
)
returns table (
  id uuid,
  doctor_id uuid,
  start_time timestamptz,
  capacity int,
  remaining int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.doctor_id,
    s.start_time,
    s.capacity,
    (s.capacity - count(c.id))::int as remaining
  from public.doctor_availability_slots s
  left join public.consultations c on c.slot_id = s.id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until)
  where s.doctor_id = p_doctor_id
    and s.start_time > greatest(coalesce(p_from, now()), now())
    and s.start_time < least(coalesce(p_to, now() + interval '7 days'), now() + interval '14 days')
  group by s.id, s.doctor_id, s.start_time, s.capacity
  having s.capacity - count(c.id) > 0
  order by s.start_time asc
  limit 800;
$$;
-- Postgres grants EXECUTE to everyone by default; this one is for signed-in
-- patients only, so take it away from the public/anon role first.
revoke execute on function public.list_doctor_open_slots(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_doctor_open_slots(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.list_available_doctors()
returns table (
  doctor_id uuid,
  -- true once this doctor has reached their daily patient ceiling
  -- (0033); the booking trigger would reject any new booking today.
  daily_full boolean,
  -- Text consultations (0031/0032).
  text_open_now boolean,
  -- Minutes until today's text window opens, only when it is still
  -- ahead of us later today (null when open now, closed for the day,
  -- or the daily text limit is already reached).
  text_opens_in_minutes int,
  -- Daily text spots left; null means this doctor has no daily limit.
  text_spots_left int,
  -- Audio/video (0021): the soonest open slot and how soon it is.
  next_call_start timestamptz,
  next_call_minutes int,
  next_call_spots int,
  -- Open audio/video slots later today (Pakistan date) and in the next
  -- 7 days.
  call_slots_today int,
  call_slots_week int
)
language sql
stable
security definer
set search_path = public
as $$
  with open_slots as (
    -- 0071: bounded to the next 7 days (was: every future slot of every
    -- doctor). Same counting rule as list_open_slots() (0021) and the
    -- booking trigger, so this never reports a slot the trigger would
    -- refuse. The 7-day bound keeps this public, un-logged-in call cheap
    -- however many slots exist further out.
    select
      s.id,
      s.doctor_id,
      s.start_time,
      s.capacity,
      (s.capacity - count(c.id))::int as remaining
    from public.doctor_availability_slots s
    left join public.consultations c on c.slot_id = s.id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until)
    where s.start_time > now()
      and s.start_time < now() + interval '7 days'
    group by s.id, s.doctor_id, s.start_time, s.capacity
    having s.capacity - count(c.id) > 0
  ),
  n as (
    select (now() at time zone 'Asia/Karachi') as pkt
  ),
  -- One pass per doctor (instead of re-scanning the slot list once per
  -- doctor), so the cost grows with the number of open slots, not
  -- doctors x slots.
  per_doc as (
    select
      s.doctor_id,
      min(s.start_time) as next_start,
      (count(*) filter (
        where (s.start_time at time zone 'Asia/Karachi')::date = n.pkt::date
      ))::int as today_cnt,
      (count(*) filter (
        where s.start_time < now() + interval '7 days'
      ))::int as week_cnt,
      (array_agg(s.remaining order by s.start_time asc))[1] as next_remaining
    from open_slots s
    cross join n
    group by s.doctor_id
  )
  select
    d.id as doctor_id,
    coalesce(cap.is_full, false) as daily_full,
    coalesce(tx.is_open, false) as text_open_now,
    case
      when tx.is_open is not true
        and tx.start_time is not null
        and n.pkt::time < tx.start_time
        and coalesce(tx.remaining, 1) > 0
      then ceil(extract(epoch from (tx.start_time - n.pkt::time)) / 60)::int
      else null
    end as text_opens_in_minutes,
    tx.remaining as text_spots_left,
    sl.next_start as next_call_start,
    case
      when sl.next_start is not null
      then greatest(ceil(extract(epoch from (sl.next_start - now())) / 60)::int, 0)
      else null
    end as next_call_minutes,
    sl.next_remaining as next_call_spots,
    coalesce(sl.today_cnt, 0) as call_slots_today,
    coalesce(sl.week_cnt, 0) as call_slots_week
  from public.public_doctor_directory d
  cross join n
  left join lateral public.text_availability_status(d.id) tx on true
  left join lateral public.doctor_daily_capacity(d.id) cap on true
  left join per_doc sl on sl.doctor_id = d.id;
$$;

-- Same exposure model as text_availability_status() and
-- doctor_daily_capacity(), which both already allow anon: the public
-- doctors page is visible without logging in.
grant execute on function public.list_available_doctors() to anon, authenticated;
