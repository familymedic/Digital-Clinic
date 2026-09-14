-- Admin system, step 1: the smallest slice the business audit called out
-- as highest-leverage — reviewing safety-flagged consultations without
-- needing Claude/SQL involved. Content publishing (approving new
-- questionnaire wording/red-flag rules) is the deliberate next step, not
-- this one — kept separate so each piece is small and independently
-- testable, per the audit's own "build incrementally" recommendation.
--
-- Scoped with the physician (2026-09-14): admin is a SEPARATE capability
-- from doctor, on the same account for now (his one login can be both),
-- modeled as its own table rather than a boolean on doctor_profiles —
-- exactly so a future non-doctor staff member (e.g. a receptionist
-- publishing content) could get admin access without also becoming a
-- doctor account. Same "no public sign-up path, migration/dashboard-only
-- insert" gate as doctor_profiles (0015), for the same reason: exactly
-- one person needs this today, and Claude cannot create accounts
-- (Section 41) — the physician creates the row himself after signing up
-- normally, same two-step pattern already used for his doctor account.

-- 1. admin_profiles: deliberately minimal, same shape as doctor_profiles.
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_profiles enable row level security;

drop policy if exists "Admins can view their own profile" on public.admin_profiles;
create policy "Admins can view their own profile"
  on public.admin_profiles for select
  using (id = auth.uid());

-- 2. Safety-event review: admin can see EVERY flagged consultation
--    (unscoped by doctor_id, unlike the doctor-facing policy in 0016 —
--    admin is meant to be doctor-network-wide from day one, same
--    "assume more than one doctor eventually" instinct already used for
--    consultations.doctor_id since Phase 4b) and can update only the
--    `status` column, via the app rather than a migration.
--
--    Written as an EXISTS check against admin_profiles rather than a
--    hard-coded UID, so this keeps working unchanged if a second admin
--    is ever added — no future migration needed just to add a person.
drop policy if exists "Admins can view all safety events" on public.consultation_safety_events;
create policy "Admins can view all safety events"
  on public.consultation_safety_events for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update safety event status" on public.consultation_safety_events;
create policy "Admins can update safety event status"
  on public.consultation_safety_events for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Column-level narrowing: even though the USING/WITH CHECK above allow
-- the UPDATE command through, only `status` should actually be
-- changeable by an admin — everything else on this table (rule
-- description, which response triggered it, when) is part of the
-- immutable clinical record. Same defense-in-depth pattern as 0014/0015
-- (RLS decides WHICH rows, column grants decide WHICH columns).
revoke update on public.consultation_safety_events from authenticated;
grant update (status) on public.consultation_safety_events to authenticated;
