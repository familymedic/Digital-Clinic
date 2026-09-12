-- Phase 8, step 2: self-service time-slot booking for audio/video
-- consultations (Section 16 area / Section 35 Appointment system).
-- Text-mode consultations are untouched — still straight into the
-- queue (0020).
--
-- Scoped with the physician as two decisions (2026-09-12):
-- (1) the doctor creates slots manually, one at a time (a date, a start
--     time, and a capacity) — no recurring-pattern generator yet;
-- (2) one shared pool of slots for both audio and video — a slot is a
--     block of the doctor's time, not tied to a call technology; which
--     mode a given booking uses is already captured by `delivery_mode`
--     (0020).
--
-- 1. The slots themselves. Doctor-only table — no patient-facing
--    SELECT policy at all. Patients discover open slots only through
--    `list_open_slots()` below, which exposes just enough (time,
--    remaining capacity) to book, never who else is booked into a
--    slot. This is deliberately narrower than most of this project's
--    doctor-owned tables (which usually get a plain doctor_id = auth.uid()
--    policy plus a separate, explicit patient view once something is
--    "issued") because there is no equivalent per-row patient
--    ownership here — a slot doesn't belong to one patient, so there's
--    no natural row-level patient policy to write; a computed,
--    security-definer view is the correct narrow interface instead.
create table if not exists public.doctor_availability_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users (id),
  start_time timestamptz not null,
  capacity int not null default 1 check (capacity > 0),
  created_at timestamptz not null default now()
);

alter table public.doctor_availability_slots enable row level security;

drop policy if exists "Doctors can view their own slots" on public.doctor_availability_slots;
create policy "Doctors can view their own slots"
  on public.doctor_availability_slots for select
  using (doctor_id = auth.uid());

drop policy if exists "Doctors can create their own slots" on public.doctor_availability_slots;
create policy "Doctors can create their own slots"
  on public.doctor_availability_slots for insert
  with check (doctor_id = auth.uid());

drop policy if exists "Doctors can update their own slots" on public.doctor_availability_slots;
create policy "Doctors can update their own slots"
  on public.doctor_availability_slots for update
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid());

drop policy if exists "Doctors can delete their own slots" on public.doctor_availability_slots;
create policy "Doctors can delete their own slots"
  on public.doctor_availability_slots for delete
  using (doctor_id = auth.uid());

-- 2. Consultations can now optionally point at the slot they were
-- booked into. No ON DELETE CASCADE/SET NULL — deleting a slot that
-- already has bookings should fail loudly (Postgres's default NO
-- ACTION) rather than silently detach a patient's scheduled time; the
-- app doesn't offer slot deletion yet regardless.
alter table public.consultations
  add column if not exists slot_id uuid references public.doctor_availability_slots (id);

alter table public.consultations
  add constraint consultations_slot_id_requires_non_text
  check (slot_id is null or delivery_mode <> 'text');

-- Same additive column-grant pattern as delivery_mode (0020) — a
-- patient chooses their own slot at booking time.
grant insert (slot_id) on public.consultations to authenticated;

-- One narrow exception to "doctor-only, no patient policy" on the
-- slots table itself: once a patient's own consultation is actually
-- booked into a slot, they need to see what time it is (their
-- dashboard shows it). This only ever exposes a slot already linked to
-- one of their own consultations — never lets them browse slots
-- generally (that stays the RPC below). No recursion risk: this
-- subqueries `consultations`, whose own patient policy subqueries
-- `family_members`, but neither of those tables' policies reference
-- `doctor_availability_slots` back, so the chain terminates rather
-- than cycling (same reasoning as 0016). Placed here, after slot_id
-- exists on consultations, since the policy references that column.
drop policy if exists "Patients can view slots for their own bookings" on public.doctor_availability_slots;
create policy "Patients can view slots for their own bookings"
  on public.doctor_availability_slots for select
  using (
    id in (
      select slot_id from public.consultations
      where slot_id is not null
        and patient_id in (select id from public.family_members where account_id = auth.uid())
    )
  );

-- 3. Capacity enforcement. A slot's remaining capacity can't be
-- checked safely from a plain client-side count-then-insert (two
-- patients booking the last spot at the same moment would both pass a
-- naive check) — this is enforced here, atomically, in the database.
-- `for update` locks the slot row for the duration of the transaction,
-- so a second concurrent booking attempt against the same slot waits
-- for the first to commit (or roll back) before it re-reads the
-- now-current count, rather than both reading a stale "not full yet".
--
-- Runs security definer, same reasoning as assign_default_doctor
-- (0015): it needs to count consultations across doctor/patient
-- boundaries regardless of the inserting patient's own RLS visibility,
-- and it needs to read doctor_availability_slots regardless of the
-- fact that table has no patient-facing SELECT policy at all.
--
-- Ordering note: trigger execution order for multiple BEFORE INSERT
-- triggers on one table is alphabetical by trigger name. This is
-- named so it runs AFTER on_consultation_assign_doctor (0015) —
-- "on_consultation_assign_doctor" sorts before
-- "on_consultation_enforce_slot_capacity" — so NEW.doctor_id is
-- already set by the time this checks it against the slot's doctor.
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
  from public.consultations
  where slot_id = new.slot_id;

  if current_bookings >= slot_capacity then
    raise exception 'Selected time slot is already full.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_consultation_enforce_slot_capacity on public.consultations;
create trigger on_consultation_enforce_slot_capacity
  before insert on public.consultations
  for each row execute function public.enforce_slot_capacity();

-- 4. Patient-facing slot discovery. Returns only what's needed to
-- book — time and how many spots are left — never who else booked
-- into a slot. security definer + a stable, safe search_path so it
-- can compute the count across the RLS boundary described above.
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
  where s.start_time > now()
  group by s.id, s.doctor_id, s.start_time, s.capacity
  having s.capacity - count(c.id) > 0
  order by s.start_time asc;
$$;

grant execute on function public.list_open_slots() to authenticated;
