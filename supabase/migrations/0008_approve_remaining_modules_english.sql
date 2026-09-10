-- Phase 5: approve the English clinical content for the remaining eight
-- complaint modules — exactly as drafted in
-- phase5-remaining-modules-draft.md and approved by the physician
-- ("the draft is approved"). Same pattern as 0005 (Fever): each module,
-- its questions, and their answer options are inserted with
-- status = 'approved', approved_by = 'Zayn'.
--
-- Shortness of Breath and Chest Pain are deliberately NOT included —
-- their draft content was explicitly conditional on the physician
-- picking option (a) (a questionnaire) over option (b) (an immediate
-- emergency message), and that choice is still open. Approving them
-- here would assume an answer that was never given.
--
-- Two small wording edits from the draft as shown: the Abdominal pain
-- "Lower right" and Urinary symptoms "fever + side/back pain" red-flag
-- notes named a possible diagnosis ("appendicitis" / "kidney
-- infection") in patient-facing text. The patient-language-layer rules
-- (no diagnosis name shown to the patient unless a specific message
-- was designed and approved for that exact situation) take precedence
-- over the general draft approval, so both notes were reworded here to
-- describe the finding without naming a diagnosis. The red flag itself,
-- the clinical variable, and the physician-facing referral_criteria
-- (which still name the diagnosis, as before) are unchanged.

do $$
declare
  module_id uuid;
  q_id uuid;
begin
  -- ============================================================
  -- Cough
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Cough', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response recommends immediate in-person or emergency evaluation rather than waiting for the scheduled consultation. A cough lasting more than 3 weeks with no red flags is flagged for the doctor as possibly needing an in-person workup, though not as an emergency.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How long has the cough lasted?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Less than a week'), (q_id, 2, '1–3 weeks'),
    (q_id, 3, 'More than 3 weeks'), (q_id, 4, 'Not sure');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Is there any blood in what you''re coughing up?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'A small streak or two', false, null),
    (q_id, 3, 'Yes, a significant amount', true, 'Coughing up a significant amount of blood needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Any difficulty breathing, or blue-tinged lips?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Mild', false, null),
    (q_id, 3, 'Yes, significant difficulty or blue lips', true, 'Significant breathing difficulty or blue-tinged lips needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Any chest pain with the cough?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Mild', false, null),
    (q_id, 3, 'Yes, severe or crushing', true, 'Severe or crushing chest pain with a cough needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'Fever with shaking chills alongside the cough?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 6, 'Do you have an existing lung or heart condition, or a weakened immune system?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes — I''ll describe it to the doctor directly');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 7, 'How would you describe alertness right now?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Normal', false, null),
    (q_id, 2, 'Tired but alert', false, null),
    (q_id, 3, 'Very drowsy, confused, or hard to wake', true, 'Reduced alertness needs prompt attention.');

  -- ============================================================
  -- Sore throat
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Sore throat', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response recommends immediate in-person or emergency evaluation (possible airway involvement or abscess). Otherwise, normal doctor review.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How long has it lasted?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Less than 3 days'), (q_id, 2, '3–7 days'), (q_id, 3, 'More than 7 days');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Are you having trouble swallowing?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Mild difficulty', false, null),
    (q_id, 3, 'Severe — can''t even swallow my own saliva', true, 'Inability to swallow saliva needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Are you drooling because it''s too painful to swallow, or having trouble breathing?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Drooling or breathing trouble with a sore throat needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Fever?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Mild'), (q_id, 3, 'High fever');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'Any muffled or "hot potato" voice change, or swelling on one side of the throat/neck?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'A muffled voice or one-sided throat swelling needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 6, 'Any rash alongside the sore throat?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes');

  -- ============================================================
  -- Abdominal pain
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Abdominal pain', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response recommends immediate in-person or emergency evaluation. Lower-right pain is flagged given how often it matters clinically.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How did the pain start?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Suddenly (within the last hour)'), (q_id, 2, 'Gradually over hours'), (q_id, 3, 'Gradually over days');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'How severe is it?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Mild', false, null),
    (q_id, 2, 'Moderate', false, null),
    (q_id, 3, 'Severe — the worst pain of my life', true, 'Pain described as the worst of your life needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Where is it worst?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'All over', false, null),
    (q_id, 2, 'Upper abdomen', false, null),
    (q_id, 3, 'Lower left', false, null),
    (q_id, 4, 'Lower right', true, 'Pain that is worst in the lower right side of your abdomen needs prompt evaluation.'),
    (q_id, 5, 'Not sure', false, null);

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Any blood in vomit or stool, or black/tarry stool?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Blood in vomit or stool, or black stool, needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'Is your abdomen rigid or hard, or does any movement cause severe pain?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'A rigid or very tender abdomen needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 6, 'If applicable — are you currently pregnant?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Not applicable', false, null),
    (q_id, 2, 'No', false, null),
    (q_id, 3, 'Yes, and I''m having this pain', true, 'Abdominal pain during pregnancy needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 7, 'Any fainting or severe dizziness with the pain?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Fainting or severe dizziness with abdominal pain needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 8, 'Fever with the pain?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes');

  -- ============================================================
  -- Diarrhea / vomiting
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Diarrhea / vomiting', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response recommends immediate in-person or emergency evaluation (dehydration risk).',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How long has this been going on?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Less than 24 hours'), (q_id, 2, '1–3 days'), (q_id, 3, 'More than 3 days');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'How frequent?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'A few times a day', false, null),
    (q_id, 2, 'Several times a day', false, null),
    (q_id, 3, '10+ times a day', true, 'Very frequent diarrhea or vomiting needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Any blood in the stool or vomit?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Blood in stool or vomit needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Any signs of dehydration — very little urine, dizziness, sunken eyes, extreme thirst?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'None', false, null),
    (q_id, 2, 'Mild (thirsty, slightly less urine)', false, null),
    (q_id, 3, 'Severe', true, 'Signs of severe dehydration need prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'Able to keep any fluids down at all?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Yes', false, null),
    (q_id, 2, 'No, can''t keep anything down for over 24 hours', true, 'Being unable to keep any fluids down for over 24 hours needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 6, 'High fever alongside this?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 7, 'Is this for an infant, an elderly person, or someone with a chronic condition (diabetes, kidney disease, etc.)?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes — I''ll describe it to the doctor directly');

  -- ============================================================
  -- Headache
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Headache', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Any red-flag response recommends immediate in-person or emergency evaluation (possible stroke, meningitis, or bleed).',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How did it start?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Gradually, like my usual headaches', false, null),
    (q_id, 2, 'Gradually, but worse than usual', false, null),
    (q_id, 3, 'Suddenly, "worst headache of my life"', true, 'A sudden, "worst headache of my life" onset needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Any fever and stiff neck along with the headache?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Fever with a stiff neck alongside a headache needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Any vision changes, weakness or numbness on one side, confusion, or slurred speech?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Vision changes, one-sided weakness or numbness, confusion, or slurred speech needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Did this follow a head injury?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes, a minor bump', false, null),
    (q_id, 3, 'Yes, a significant injury', true, 'A significant head injury with a headache needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'How does this compare to headaches you''ve had before (e.g. migraines)?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'This is a familiar pattern for me'), (q_id, 2, 'This is new or different for me');

  -- ============================================================
  -- Back pain
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Back pain', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Questions 1, 2, and 4 flag for cauda equina / spinal infection risk and recommend immediate in-person or emergency evaluation.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'Any loss of bladder or bowel control, or numbness in the groin/inner thighs?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Loss of bladder or bowel control, or groin numbness, needs urgent attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Any weakness or numbness in one or both legs?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Weakness or numbness in the legs needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Did this follow an injury or fall?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes, minor'), (q_id, 3, 'Yes, significant');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Fever along with the back pain?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Fever with back pain needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'Any history of cancer, or unexplained weight loss recently?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'No'), (q_id, 2, 'Yes — I''ll describe it to the doctor directly');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 6, 'How severe is the pain?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Mild'), (q_id, 2, 'Moderate'), (q_id, 3, 'Severe');

  -- ============================================================
  -- Urinary symptoms
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Urinary symptoms', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'Complete inability to urinate is an urgent flag. Blood in urine or fever with flank pain recommend prompt (same-day) evaluation.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'Burning or pain when urinating?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'None'), (q_id, 2, 'Mild'), (q_id, 3, 'Severe');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Blood in the urine?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Blood in the urine needs prompt evaluation.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'Fever along with pain in your side or back?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Fever together with side or back pain needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 4, 'Are you completely unable to urinate at all?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No, I''m passing urine normally', false, null),
    (q_id, 2, 'Yes, I can''t pass any urine at all', true, 'Being completely unable to pass urine needs urgent attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 5, 'If applicable — are you currently pregnant?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Not applicable'), (q_id, 2, 'No'), (q_id, 3, 'Yes');

  -- ============================================================
  -- Other
  -- ============================================================
  insert into public.clinical_modules
    (complaint, version, status, emergency_wording, referral_criteria, guideline_source, approved_by, approved_at)
  values (
    'Other', 1, 'approved',
    'If you think you are having a medical emergency, do not wait for an online consultation. Seek immediate emergency medical care or contact your local emergency service.',
    'A generic safety screen only — every case still goes to normal doctor review regardless of answers, since there is no complaint-specific structure to guide it.',
    'Clinical judgment — Dr. Zayn', 'Zayn', now()
  ) returning id into module_id;

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 1, 'How severe would you say this is?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'Mild', false, null),
    (q_id, 2, 'Moderate', false, null),
    (q_id, 3, 'Severe — the worst I''ve felt', true, 'Symptoms described as the worst you''ve felt need prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 2, 'Any difficulty breathing, chest pain, confusion, uncontrolled bleeding, or fainting?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label, is_red_flag, red_flag_note) values
    (q_id, 1, 'No', false, null),
    (q_id, 2, 'Yes', true, 'Difficulty breathing, chest pain, confusion, uncontrolled bleeding, or fainting needs prompt attention.');

  insert into public.clinical_questions (module_id, position, question_text) values
    (module_id, 3, 'How long has this been going on?') returning id into q_id;
  insert into public.clinical_answer_options (question_id, position, label) values
    (q_id, 1, 'Less than a day'), (q_id, 2, 'A few days'), (q_id, 3, 'A week or more');

  -- Note: "Other"'s free-text "in your own words" field is a UI-level
  -- addition (Section 8), not a multiple-choice question — it has no
  -- row here since there is nothing to structure or red-flag; the
  -- app displays it as a plain text field alongside these questions.
end $$;
