-- Phase 5: first approved clinical content.
--
-- This is the one migration in the whole project that inserts real
-- clinical content — and it does so only because the physician
-- explicitly reviewed and approved it ("good to go") after seeing the
-- draft (phase5-fever-module-draft.md) and a working preview of the
-- flow. Per Section 0/17, Claude drafts clinical content but never
-- finalizes it on its own initiative; running this migration is that
-- approval being recorded, not a judgment call made here.
--
-- Inserts:
--   1. The AI-history consent (Section 7) as consent_versions v1,
--      approved. This is shared across every complaint, not
--      Fever-specific — approving it here unblocks every future module,
--      not just this one.
--   2. The Fever module (Section 17) as clinical_modules v1, approved,
--      with its 9 questions and their answer options, exactly as
--      reviewed in phase5-fever-module-draft.md.
--
-- Once this runs, Fever becomes the first live complaint: patients
-- booking a Fever consultation will see the real consent screen and
-- guided questions instead of the "not ready yet" honest placeholder.

insert into public.consent_versions (version, body, status, approved_by, approved_at)
values (
  1,
  'Before we begin: this short questionnaire helps organize your symptoms for your doctor. It is not a diagnosis, and it does not replace speaking with your doctor — your doctor reviews every answer before making any medical decision. If any answer suggests you may need urgent care, we''ll tell you clearly and recommend you seek immediate care rather than wait for this consultation. If you feel this is a medical emergency right now, do not wait — contact emergency services immediately.

By continuing, you''re agreeing to answer as accurately as you can, understanding this is a tool to help your doctor — not a substitute for their judgment.',
  'approved',
  'Zayn',
  now()
);

do $$
declare
  fever_module_id uuid;
  q_id uuid;
begin
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Fever',
    1,
    'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response above recommends immediate in-person or emergency evaluation rather than waiting for the scheduled consultation. A fever consultation with no red-flag responses proceeds to normal doctor review.',
    'Clinical judgment — Dr. Zayn',
    'Zayn',
    now()
  )
  returning id into fever_module_id;

  -- Q1
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 1, 'When did the fever start?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Today'),
    (q_id, 2, '1–2 days ago'),
    (q_id, 3, '3–5 days ago'),
    (q_id, 4, 'More than 5 days'),
    (q_id, 5, 'Not sure');

  -- Q2
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 2, 'What''s the highest temperature you''ve measured, if you checked?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Below 100°F'),
    (q_id, 2, '100–102°F'),
    (q_id, 3, 'Above 102°F'),
    (q_id, 4, 'Haven''t measured it');

  -- Q3
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 3, 'Any difficulty breathing, or breathing unusually fast?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Mild', false, null),
    (q_id, 3, 'Yes, significant difficulty', true, 'Significant breathing difficulty with fever needs prompt attention.');

  -- Q4
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 4, 'Along with the fever, is there a stiff neck, severe headache, or unusual sensitivity to light?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Mild headache only', false, null),
    (q_id, 3, 'Yes, stiff neck and/or light sensitivity', true, 'A stiff neck or light sensitivity with fever needs prompt attention.');

  -- Q5
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 5, 'Any repeated vomiting or signs of dehydration (very little urine, dizziness, unable to keep fluids down)?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Some vomiting but keeping fluids down', false, null),
    (q_id, 3, 'Yes, can''t keep fluids down', true, 'Inability to keep fluids down with fever needs prompt attention.');

  -- Q6
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 6, 'Any rash — especially one that doesn''t fade when pressed — or unusually pale, blue, or grey skin color?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'A non-fading rash or unusual skin color with fever needs prompt attention.');

  -- Q7
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 7, 'Is this fever in a baby under 3 months old?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Not applicable', false, null),
    (q_id, 2, 'Yes, this is a baby under 3 months', true, 'Fever in an infant under 3 months needs prompt attention.');

  -- Q8
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 8, 'How would you describe alertness right now?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Normal', false, null),
    (q_id, 2, 'Tired but alert', false, null),
    (q_id, 3, 'Very drowsy, confused, or hard to wake', true, 'Reduced alertness with fever needs prompt attention.');

  -- Q9
  insert into public.clinical_questions (module_id, position, question_text)
  values (fever_module_id, 9, 'Anything else worth flagging — recent travel, known exposure to a contagious illness, or an existing condition like diabetes, heart/lung disease, or a weakened immune system?')
  returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'),
    (q_id, 2, 'Yes — I''ll describe it to the doctor directly');
end $$;
