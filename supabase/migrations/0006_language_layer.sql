-- Phase 5: Patient Language Layer — infrastructure only, no translations
-- inserted here.
--
-- This is a presentation layer in front of the existing Clinical
-- Configuration Layer. It changes nothing about clinical terminology,
-- the database structure of clinical content, the rule engine, or
-- physician-facing documentation — clinical_questions.question_text and
-- clinical_answer_options.label remain the single canonical English
-- source of truth. Translations are purely additive rows that the app
-- displays instead of the English text when a patient has chosen
-- another language and an approved translation exists — falling back to
-- English otherwise. Same draft -> approved gate as clinical content
-- (Section 17), so nothing here becomes visible to a patient until
-- explicitly approved, same as every other migration in this project.

create table if not exists public.languages (
  code text primary key,
  label text not null,
  is_active boolean not null default true
);

insert into public.languages (code, label) values
  ('en', 'English'),
  ('ur-roman', 'Roman Urdu')
on conflict (code) do nothing;

alter table public.languages enable row level security;

drop policy if exists "Anyone signed in can read languages" on public.languages;
create policy "Anyone signed in can read languages"
  on public.languages for select
  using (auth.role() = 'authenticated');

-- Translation of a question's text into a non-English language.
create table if not exists public.question_translations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.clinical_questions (id) on delete cascade,
  language text not null references public.languages (code),
  wording_text text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  version int not null default 1,
  reviewer text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (question_id, language, version)
);

alter table public.question_translations enable row level security;

drop policy if exists "Anyone signed in can read approved question translations" on public.question_translations;
create policy "Anyone signed in can read approved question translations"
  on public.question_translations for select
  using (auth.role() = 'authenticated' and status = 'approved');

-- Translation of an answer option's label (and, if it's a red-flag
-- option, its patient-facing note) into a non-English language.
create table if not exists public.answer_option_translations (
  id uuid primary key default gen_random_uuid(),
  answer_option_id uuid not null references public.clinical_answer_options (id) on delete cascade,
  language text not null references public.languages (code),
  label_text text not null,
  red_flag_note_text text,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  version int not null default 1,
  reviewer text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (answer_option_id, language, version)
);

alter table public.answer_option_translations enable row level security;

drop policy if exists "Anyone signed in can read approved answer option translations" on public.answer_option_translations;
create policy "Anyone signed in can read approved answer option translations"
  on public.answer_option_translations for select
  using (auth.role() = 'authenticated' and status = 'approved');

-- consent_versions gains a language column so the same version number
-- can exist in more than one language, each independently approved.
alter table public.consent_versions
  add column if not exists language text not null default 'en' references public.languages (code);

alter table public.consent_versions drop constraint if exists consent_versions_version_key;
alter table public.consent_versions
  add constraint consent_versions_version_language_key unique (version, language);

-- consultations records which language the patient chose for this
-- consultation's history-taking (Section 11: store the language used).
-- Nullable and no default — the app treats "not yet chosen" as its own
-- state and asks explicitly, rather than silently assuming English.
alter table public.consultations
  add column if not exists patient_language text references public.languages (code);

-- Every response records which language the patient was shown, so a
-- doctor reviewing later can reconstruct exactly what the patient saw —
-- not just the English text of the option they picked.
alter table public.consultation_history_responses
  add column if not exists language text not null default 'en' references public.languages (code);
