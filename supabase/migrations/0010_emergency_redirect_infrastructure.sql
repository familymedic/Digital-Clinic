-- Phase 5: infrastructure for the Shortness of Breath / Chest Pain
-- design decision the physician just made ("approved seek immediate
-- care for Chest pain and shortness of breath red flags" -- i.e.
-- option (b) from the open question in phase5-remaining-modules-draft.md
-- and phase5-language-layer-full-set.md): these two complaints skip
-- the guided questionnaire entirely and show an immediate "seek
-- emergency care" message instead, in the patient's chosen language.
--
-- This migration is infrastructure + the two complaint categories
-- themselves -- it does NOT approve the message wording. Same pattern
-- as 0004 (Clinical Configuration Layer infrastructure) before 0005
-- approved Fever's actual content: the app can recognize "Shortness of
-- breath" and "Chest pain" as real, approved complaint categories with
-- no questionnaire, but shows an honest "not ready yet" state until a
-- follow-up migration marks the message text itself approved.
--
-- 1. A new table for the redirect message. Not module-specific -- the
--    physician chose one shared message for both complaints, so this
--    is a single small table (language, body, draft/approved gate),
--    not a module_id-keyed one. Same draft->approved gate as every
--    other patient-facing table in this layer (0004, 0006).
create table if not exists public.emergency_redirect_messages (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  language text not null references public.languages (code),
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (version, language)
);

alter table public.emergency_redirect_messages enable row level security;

drop policy if exists "Anyone signed in can read approved emergency redirect messages" on public.emergency_redirect_messages;
create policy "Anyone signed in can read approved emergency redirect messages"
  on public.emergency_redirect_messages for select
  using (auth.role() = 'authenticated' and status = 'approved');

-- 2. The two complaint categories, approved as modules with ZERO
--    clinical_questions -- the app already treats a module with no
--    questions as a signal to skip straight to the redirect message
--    rather than a questionnaire (no schema change needed for that:
--    consultation_safety_events.triggered_by_response_id is already
--    nullable, and consultations.history_method is already nullable,
--    so a "no questions were asked, no method was chosen" consultation
--    fits the existing schema as-is). complaint values match the
--    booking page's list exactly ("Shortness of breath", "Chest pain").
--
--    Note for a future doctor dashboard (Phase 7): history_status =
--    'completed' here does NOT mean structured answers exist to
--    review -- it means the patient acknowledged the emergency
--    message. Check consultation_history_responses for an actual
--    count before assuming "completed" implies answered questions.
insert into public.clinical_modules
  (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
values (
  'Shortness of breath', 1, 'approved',
  null,
  'By physician design, this complaint shows an immediate "seek emergency care" message instead of a guided questionnaire (Section 8 design decision, resolved 2026-09-10) -- the risk of delaying on a multi-question triage was judged higher than the value of the triage itself. The patient can still continue to book/reach the doctor through the platform in parallel; every such consultation is auto-flagged for priority review regardless of anything else the patient does.',
  'Clinical judgment -- Dr. Zayn', 'Zayn', now()
);

insert into public.clinical_modules
  (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
values (
  'Chest pain', 1, 'approved',
  null,
  'By physician design, this complaint shows an immediate "seek emergency care" message instead of a guided questionnaire (Section 8 design decision, resolved 2026-09-10) -- same rationale as Shortness of Breath. The patient can still continue to book/reach the doctor through the platform in parallel; every such consultation is auto-flagged for priority review regardless of anything else the patient does.',
  'Clinical judgment -- Dr. Zayn', 'Zayn', now()
);

-- 3. The proposed message text itself, inserted as DRAFT only -- not
--    yet approved. Shown to the physician for explicit sign-off in
--    the same conversation this migration was written in; a follow-up
--    migration (0011) will flip both rows to status = 'approved' once
--    he confirms the exact wording (or an edited version of it).
insert into public.emergency_redirect_messages (version, language, body, status)
values (
  1, 'en',
  'Based on what you selected, this may need faster attention than an online consultation alone can give. Please don''t wait -- go to the nearest emergency department, or call your local emergency number, right now. You can still reach your doctor through this platform below, and they''ll follow up as a priority -- but please don''t wait for that if you''re worried right now.',
  'draft'
)
on conflict do nothing;

insert into public.emergency_redirect_messages (version, language, body, status)
values (
  1, 'ur-roman',
  'Aapne jo batayā hai, us ke mutabiq foran tawajjo zaroori ho sakti hai — sirf online consultation kaafi nahi hoga. Intezaar na karein — abhi nazdeeki emergency (ER) jayein, ya apni local emergency number par call karein. Aap neechay is platform ke zariye apne doctor tak bhi pohanch sakte hain, jo isay foran dekhein ge — lekin agar abhi fikar mand hain to iske liye intezaar na karein.',
  'draft'
)
on conflict do nothing;
