-- SUPERSEDED — do not run this file.
--
-- Before this was ever tested against a real database, Phase 4 was
-- extended to support family accounts (one login managing several
-- patients). 0003_family_members.sql replaces this table's design
-- (patient_id now points at family_members, plus a doctor_id column) and
-- creates it directly — it does not require this file to have run
-- first. Kept here only as a record of what Phase 4 originally shipped.
--
-- Phase 4: the Consultation record itself — the anchor of the whole
-- clinical spine (Patient -> Consultation -> Clinical Record, blueprint
-- Section 2). This phase only creates the record and its status; the AI
-- history (Phase 5), safety events (Phase 6), doctor assessment (Phase 7),
-- appointment/scheduling (Phase 8), and payment (Phase 10) all attach to
-- this same row in later phases — nothing here is designed in a way that
-- would make that awkward later.

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profiles (id) on delete cascade,
  complaint text not null,
  -- Deliberately a single status for now ('submitted'). Later phases add
  -- real transitions (e.g. history_in_progress, awaiting_doctor,
  -- in_consultation, completed) once there's an AI history step and a
  -- doctor dashboard to actually act on them — adding those later is a
  -- column-value change, not a schema change.
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

alter table public.consultations enable row level security;

create policy "Patients can view their own consultations"
  on public.consultations for select
  using (auth.uid() = patient_id);

create policy "Patients can create their own consultations"
  on public.consultations for insert
  with check (auth.uid() = patient_id);

-- No doctor-facing policy yet — deliberately. It arrives with the doctor
-- dashboard (Phase 7), added as its own reviewed change rather than
-- bundled in here, per the blueprint's change-control principle
-- (Section 38: database relationship changes are flagged, not silent).
