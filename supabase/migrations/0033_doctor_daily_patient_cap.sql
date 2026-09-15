-- Daily patient cap, across ALL consultation types (2026-09-15): the
-- physician asked directly whether there was any limit on how many
-- patients a doctor sees in a day. There wasn't a combined one — text
-- has its own optional daily count (0031), and audio/video are only
-- ever bounded by however many time slots a doctor manually creates
-- (0021) — nothing stops the two from adding up past what's reasonable
-- for one doctor in one day. Confirmed with the physician: a hard
-- ceiling of 100 patients/day for now, admin-adjustable per doctor (not
-- doctor-adjustable — the same "admin decides capacity" model already
-- used for PMDC approval and fees above PKR 1,500).
--
-- This is a THIRD, independent layer on top of the two that already
-- exist — it doesn't replace or change slot capacity (0021) or text's
-- own window/count (0031/0032), it adds one more check every booking
-- has to pass regardless of delivery_mode. All three can reject a
-- booking for different reasons; this one specifically means "this
-- doctor's total workload for today, of any kind, is already full."

-- 1. doctor_profiles gains the cap. NOT NULL with a real default (100)
--    rather than nullable-means-unlimited (unlike this project's usual
--    "no row = unrestricted" pattern for brand-new optional features)
--    — the physician explicitly asked for a ceiling that applies to
--    every doctor immediately, not something opt-in.
alter table public.doctor_profiles
  add column if not exists daily_patient_cap int not null default 100;

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_daily_patient_cap_check;

alter table public.doctor_profiles
  add constraint doctor_profiles_daily_patient_cap_check
  check (daily_patient_cap > 0);

-- No RLS/grant change needed: doctor_profiles has no doctor-facing
-- UPDATE policy at all (checked when 0027 and 0029 were written, still
-- true) — only the admin-gated policy from 0026 can write this new
-- column, which is exactly "let admin expand it, not the doctor."

-- 2. Enforcement — a database trigger, same "never trust the client"
--    principle as every other capacity/payment gate in this app. Runs
--    for every delivery_mode (unlike enforce_text_availability, which
--    only checks text). Locks the doctor's own doctor_profiles row for
--    the transaction, same race-condition protection as
--    enforce_slot_capacity (0021) and enforce_text_availability
--    (0031) use for their own tables. Named to sort alphabetically
--    after "on_consultation_assign_doctor" (so NEW.doctor_id is
--    already set) and before the other two enforce_* triggers — order
--    among the three enforce_* triggers doesn't otherwise matter, they
--    check independent things.
create or replace function public.enforce_daily_patient_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_now_pkt timestamp;
  v_today_count int;
begin
  select daily_patient_cap into v_cap
  from public.doctor_profiles
  where id = new.doctor_id
  for update;

  if v_cap is null then
    -- No doctor_profiles row for this doctor_id at all — shouldn't be
    -- reachable (assign_default_doctor already validates doctor_id
    -- against a live doctor_profiles row before this trigger runs),
    -- but fail open rather than block on a state that can't sensibly
    -- be capped.
    return new;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = new.doctor_id
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  if v_today_count >= v_cap then
    raise exception
      'This doctor has reached their maximum of % patients for today across all consultation types. Please try again tomorrow or choose a different doctor.',
      v_cap;
  end if;

  return new;
end;
$$;

drop trigger if exists on_consultation_enforce_daily_patient_cap on public.consultations;
create trigger on_consultation_enforce_daily_patient_cap
  before insert on public.consultations
  for each row execute function public.enforce_daily_patient_cap();

-- 3. Patient/doctor-facing status check, same shape as
--    text_availability_status() (0031) — lets the booking page warn
--    "fully booked today" before a patient goes through the whole flow
--    only to be rejected at the end, and lets a doctor see their own
--    load on their dashboard. Never exposes anything beyond a count
--    and a cap for the doctor asked about — the same level of detail
--    already public via the doctor directory (consultation_fee) and
--    text_availability_status.
create or replace function public.doctor_daily_capacity(p_doctor_id uuid)
returns table (
  daily_cap int,
  today_count int,
  remaining int,
  is_full boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_now_pkt timestamp;
  v_today_count int;
begin
  select dp.daily_patient_cap into v_cap
  from public.doctor_profiles dp
  where dp.id = p_doctor_id;

  if not found then
    return;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = p_doctor_id
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  return query select v_cap, v_today_count, greatest(v_cap - v_today_count, 0), (v_today_count >= v_cap);
end;
$$;

grant execute on function public.doctor_daily_capacity(uuid) to authenticated, anon;
