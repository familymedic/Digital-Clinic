-- Phase 5: AI-guided history — infrastructure only, no clinical content.
--
-- Per the blueprint's Clinical Configuration Layer (Section 17) and Core
-- Architectural Principle (Section 0), clinical content — history
-- questions, red-flag criteria, consent wording — is NEVER hard-coded
-- into application logic, and Claude never finalizes it. This migration
-- creates the versioned, approval-tracked tables that content will live
-- in; it inserts zero rows. Nothing becomes visible to a patient until a
-- module's status is flipped to 'approved' by a separate, explicit
-- migration written only after the physician has reviewed and approved
-- the actual wording — see the draft Fever module sent alongside this
-- migration for review, not yet included here.
--
-- This migration only ALTERs consultations (adds columns), it does not
-- drop or recreate it — Phase 4b's confirmed real test data (a booked
-- Fever consultation) stays intact.

-- 1. A "module" is one complaint's approved history-taking content
--    (e.g. Fever v1). Draft modules exist here for editing/review but
--    are invisible to the app until status = 'approved'.
create table if not exists public.clinical_modules (
  id uuid primary key default gen_random_uuid(),
  complaint text not null,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  emergency_wording text,
  referral_criteria text,
  guideline_source text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (complaint, version)
);

alter table public.clinical_modules enable row level security;

drop policy if exists "Anyone signed in can read approved modules" on public.clinical_modules;
create policy "Anyone signed in can read approved modules"
  on public.clinical_modules for select
  using (auth.role() = 'authenticated' and status = 'approved');

-- 2. Questions belong to a module, in a fixed order.
create table if not exists public.clinical_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.clinical_modules (id) on delete cascade,
  position int not null,
  question_text text not null,
  help_text text,
  created_at timestamptz not null default now()
);

alter table public.clinical_questions enable row level security;

drop policy if exists "Anyone signed in can read questions of approved modules" on public.clinical_questions;
create policy "Anyone signed in can read questions of approved modules"
  on public.clinical_questions for select
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.clinical_modules m
      where m.id = clinical_questions.module_id and m.status = 'approved'
    )
  );

-- 3. Each question is multiple-choice. A specific answer option can be
--    marked as a red-flag trigger — this is the "deterministic clinical
--    safety rule" from Section 12, not an AI judgment call.
create table if not exists public.clinical_answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.clinical_questions (id) on delete cascade,
  position int not null,
  label text not null,
  is_red_flag boolean not null default false,
  red_flag_note text,
  created_at timestamptz not null default now()
);

alter table public.clinical_answer_options enable row level security;

drop policy if exists "Anyone signed in can read options of approved modules" on public.clinical_answer_options;
create policy "Anyone signed in can read options of approved modules"
  on public.clinical_answer_options for select
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.clinical_questions q
      join public.clinical_modules m on m.id = q.module_id
      where q.id = clinical_answer_options.question_id and m.status = 'approved'
    )
  );

-- 4. The AI-assisted-history consent (Section 7) — separate from the
--    general Terms/Privacy checkbox at registration. Also versioned and
--    draft-gated; not shown to patients until approved.
create table if not exists public.consent_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (version)
);

alter table public.consent_versions enable row level security;

drop policy if exists "Anyone signed in can read the approved consent" on public.consent_versions;
create policy "Anyone signed in can read the approved consent"
  on public.consent_versions for select
  using (auth.role() = 'authenticated' and status = 'approved');

-- 5. consultations gains the columns needed to run a history flow.
--    Added, not replacing — existing rows (e.g. the physician's own
--    tested Fever booking) are untouched.
alter table public.consultations
  add column if not exists module_id uuid references public.clinical_modules (id),
  add column if not exists history_method text check (history_method in ('ai_guided', 'voice_note')),
  add column if not exists history_status text not null default 'not_started'
    check (history_status in ('not_started', 'in_progress', 'completed')),
  add column if not exists is_flagged boolean not null default false;

-- 6. A discrete consent record per consultation (Section 7: patient,
--    consultation, consent version, timestamp — not implied by Terms).
create table if not exists public.consultation_consents (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  consent_version_id uuid not null references public.consent_versions (id),
  accepted_at timestamptz not null default now()
);

alter table public.consultation_consents enable row level security;

drop policy if exists "Account holders can view their family's consents" on public.consultation_consents;
create policy "Account holders can view their family's consents"
  on public.consultation_consents for select
  using (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

drop policy if exists "Account holders can record consent for their family" on public.consultation_consents;
create policy "Account holders can record consent for their family"
  on public.consultation_consents for insert
  with check (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

-- 7. Every answer given during a guided history. Provenance is implicit
--    and honest here: this is a multiple-choice answer the patient (or
--    the family member managing their account) selected themselves —
--    never upgraded to "confirmed" (Section 10/11).
create table if not exists public.consultation_history_responses (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  question_id uuid not null references public.clinical_questions (id),
  answer_option_id uuid not null references public.clinical_answer_options (id),
  created_at timestamptz not null default now()
);

alter table public.consultation_history_responses enable row level security;

drop policy if exists "Account holders can view their family's responses" on public.consultation_history_responses;
create policy "Account holders can view their family's responses"
  on public.consultation_history_responses for select
  using (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

drop policy if exists "Account holders can record responses for their family" on public.consultation_history_responses;
create policy "Account holders can record responses for their family"
  on public.consultation_history_responses for insert
  with check (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

-- 8. Safety Events (Section 12): full traceability of every red-flag
--    trigger — timestamp, which rule/version fired, the patient's
--    response, the system's action. No doctor-facing review workflow
--    yet (that's Phase 7's doctor dashboard) — this just guarantees the
--    record is never lost.
create table if not exists public.consultation_safety_events (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  triggered_by_response_id uuid references public.consultation_history_responses (id),
  rule_description text not null,
  system_action text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.consultation_safety_events enable row level security;

drop policy if exists "Account holders can view their family's safety events" on public.consultation_safety_events;
create policy "Account holders can view their family's safety events"
  on public.consultation_safety_events for select
  using (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

drop policy if exists "Account holders can create safety events for their family" on public.consultation_safety_events;
create policy "Account holders can create safety events for their family"
  on public.consultation_safety_events for insert
  with check (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

-- No doctor-facing policies on any table above yet — deliberately
-- deferred to the doctor dashboard (Phase 7), same pattern as 0002/0003.
