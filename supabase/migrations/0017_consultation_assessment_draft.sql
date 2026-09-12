-- Phase 7, step 3: the doctor writes up a consultation — assessment/
-- diagnosis, advice/plan, referral, follow-up, and a structured
-- medication list (Section 15). Scoped as draft entry only, per the
-- physician's choice (2026-09-12): the doctor can write and edit this,
-- doctor-side only. No "Approve & Issue" finalization and no
-- patient-facing view yet — Section 15's "Save draft → Physician
-- review → Approve & Issue" gate, and Section 16's patient view, are
-- the next increment, once there's an actual draft to issue.
--
-- Field consolidation, flagged rather than silent: Section 15 lists
-- assessment, diagnosis, plan, prescription, advice, referral, and
-- follow-up as separate concepts. To keep this first form usable rather
-- than seven near-duplicate boxes, "assessment" and "diagnosis" share
-- one field, and "advice" and "plan" share another; "prescription" is
-- the structured medication list below, and "referral" and "follow-up"
-- each keep their own field. Nothing here prevents splitting these
-- further later if the physician wants that distinction in practice.

-- 1. One assessment/plan per consultation. `status` is included now
--    (rather than added in a later ALTER) since 'draft' already
--    describes exactly what every row is at this stage — the app
--    itself has no way to set anything but 'draft' yet.
create table if not exists public.consultation_assessments (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  doctor_id uuid not null references auth.users (id),
  assessment text,
  advice text,
  referral text,
  follow_up_date date,
  follow_up_reason text,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consultation_assessments enable row level security;

drop policy if exists "Doctors can view their own assessments" on public.consultation_assessments;
create policy "Doctors can view their own assessments"
  on public.consultation_assessments for select
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

drop policy if exists "Doctors can create assessments for their consultations" on public.consultation_assessments;
create policy "Doctors can create assessments for their consultations"
  on public.consultation_assessments for insert
  with check (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and doctor_id = auth.uid()
  );

drop policy if exists "Doctors can update their own draft assessments" on public.consultation_assessments;
create policy "Doctors can update their own draft assessments"
  on public.consultation_assessments for update
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()))
  with check (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and doctor_id = auth.uid()
  );

-- No patient-facing SELECT policy yet — deliberately, same pattern as
-- every prior phase's deferral. A draft is not something a patient
-- should ever see, and this table has no way to hold anything but a
-- draft yet regardless.

-- 2. A structured medication list, one or more rows per consultation.
create table if not exists public.consultation_medications (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  position int not null default 1,
  medication_name text not null,
  dosage text,
  instructions text,
  created_at timestamptz not null default now()
);

alter table public.consultation_medications enable row level security;

drop policy if exists "Doctors can view their patients' medications" on public.consultation_medications;
create policy "Doctors can view their patients' medications"
  on public.consultation_medications for select
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

drop policy if exists "Doctors can add medications for their consultations" on public.consultation_medications;
create policy "Doctors can add medications for their consultations"
  on public.consultation_medications for insert
  with check (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

drop policy if exists "Doctors can update medications for their consultations" on public.consultation_medications;
create policy "Doctors can update medications for their consultations"
  on public.consultation_medications for update
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()))
  with check (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

drop policy if exists "Doctors can remove medications for their consultations" on public.consultation_medications;
create policy "Doctors can remove medications for their consultations"
  on public.consultation_medications for delete
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));
