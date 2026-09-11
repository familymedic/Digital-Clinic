-- Phase 7, step 1: Doctor login + consultation queue (foundation only —
-- no clinical workspace detail view or prescriptions yet; those are the
-- next increments, per the physician's scoping choice 2026-09-11).
--
-- Decisions made when scoping this step:
-- 1. First increment = doctor login + a read-only consultation queue
--    (patient, complaint, status, safety flag). Nothing more yet.
-- 2. Doctor login = a fully separate /doctor/login page and route,
--    never mixed into the patient /login form or nav — even though it
--    uses the exact same Supabase Auth underneath (Section 22: no
--    separate auth system is being built, just a separate front door).
--
-- There is currently no concept of a "doctor" anywhere in this schema —
-- every account created so far is a patient/family account. This
-- migration adds the smallest thing that can distinguish a doctor
-- account from a patient account, without touching how patient accounts
-- work at all.
--
-- IMPORTANT — this migration alone does not create a doctor account. It
-- only adds the table and policies. Creating the actual doctor account
-- is a manual step for the physician, on purpose (Section 41: Claude
-- cannot create accounts) — see the delivery notes for exact steps
-- (sign up an account the normal way, then a short one-line SQL insert
-- using that account's id).

-- 1. doctor_profiles: marks a specific auth.users row as a doctor.
--    Deliberately minimal — just enough to identify a doctor account
--    and show a name. No public sign-up path and no INSERT policy is
--    given here: for now (Section 22 — multi-doctor model is deferred),
--    only a migration/dashboard-level insert (run by the physician
--    himself, or by Claude at his explicit instruction) can create a
--    row here, which is the intended gate given there is exactly one
--    doctor.
create table if not exists public.doctor_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

alter table public.doctor_profiles enable row level security;

drop policy if exists "Doctors can view their own profile" on public.doctor_profiles;
create policy "Doctors can view their own profile"
  on public.doctor_profiles for select
  using (id = auth.uid());

-- 2. Doctors can see the consultations assigned to them, and the family
--    member profile (name, relationship, date of birth) of the patient
--    on each one — the minimum needed to render a queue row ("Ahmed
--    Test, Fever, submitted, ⚠ flagged"). This is intentionally
--    read-only and does not yet expose history responses, safety-event
--    detail, or consents — those come with the clinical workspace
--    (next increment), and are a deliberate boundary, not an oversight.
drop policy if exists "Doctors can view their assigned consultations" on public.consultations;
create policy "Doctors can view their assigned consultations"
  on public.consultations for select
  using (doctor_id = auth.uid());

-- Caught by local testing before this ever reached a real database:
-- writing the family_members policy below as a plain subquery on
-- consultations ("id in (select patient_id from consultations where
-- doctor_id = auth.uid())") causes Postgres to report "infinite
-- recursion detected in policy for relation family_members". Why: RLS
-- evaluates ALL of a table's applicable policies (combined with OR) for
-- any access to it, regardless of the query's own WHERE clause — so
-- checking visibility of a consultations row also evaluates the
-- existing "Account holders can view their family's consultations"
-- policy, which itself subqueries family_members; if family_members'
-- own policy then subqueries consultations right back, the two tables'
-- policies call each other forever. The standard, documented fix is a
-- `security definer` helper function: because it runs as the function's
-- owner (the table owner, exempt from that table's own RLS unless FORCE
-- ROW LEVEL SECURITY is set — which it isn't here), the query inside it
-- reads `consultations` directly without re-triggering RLS on it at
-- all, breaking the cycle. Verified locally: the exact recursion error
-- reproduced with the plain-subquery version, and disappeared with this
-- version, before either was shipped.
create or replace function public.is_doctor_for_patient(check_patient_id uuid, check_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.consultations
    where patient_id = check_patient_id and doctor_id = check_doctor_id
  );
$$;

drop policy if exists "Doctors can view their patients' family profile" on public.family_members;
create policy "Doctors can view their patients' family profile"
  on public.family_members for select
  using (public.is_doctor_for_patient(id, auth.uid()));

-- 3. Auto-assign the doctor on booking. Until now `doctor_id` has sat
--    unused (added in 0003, never set by anything) because there was no
--    doctor to assign and no queue to show it in. With exactly one
--    doctor for the foreseeable future (Section 22), the simplest
--    correct behavior is: every new consultation is automatically
--    assigned to that one doctor, the moment it's created. This is a
--    deliberate, temporary single-doctor shortcut — when a second
--    doctor is ever added (Phase 15+), this trigger is exactly the one
--    place that needs real assignment logic (e.g. by availability or
--    complaint type), not a scattered change across the app.
--
--    Runs as security definer so it can set doctor_id regardless of the
--    inserting patient's own column-level grants (see #4 below) — the
--    patient's own request never determines who their doctor is.
create or replace function public.assign_default_doctor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  the_doctor uuid;
begin
  if new.doctor_id is null then
    select id into the_doctor from public.doctor_profiles order by created_at asc limit 1;
    new.doctor_id := the_doctor; -- still null if no doctor exists yet — unchanged, safe behavior
  end if;
  return new;
end;
$$;

drop trigger if exists on_consultation_assign_doctor on public.consultations;
create trigger on_consultation_assign_doctor
  before insert on public.consultations
  for each row execute function public.assign_default_doctor();

-- 4. Defense in depth, same pattern as 0014's UPDATE fix: nothing in
--    the schema so far actually stopped a patient's own INSERT from
--    specifying doctor_id, status, is_flagged, or any other column
--    directly (RLS's WITH CHECK only ever verified patient_id
--    ownership, not which columns were being set). The app itself has
--    only ever sent patient_id + complaint, but a direct API call could
--    have sent anything. Closing that off now, while doctor_id
--    assignment is being built, rather than leaving it open:
revoke insert on public.consultations from authenticated;
grant insert (patient_id, complaint) on public.consultations to authenticated;
