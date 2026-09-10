-- Phase 5: approve Roman Urdu translations for the eight complaint
-- modules approved in English in 0008 (Cough, Sore throat, Abdominal
-- pain, Diarrhea/vomiting, Headache, Back pain, Urinary symptoms,
-- Other). Same pattern as 0007 (Fever's Roman Urdu): only wording is
-- added here — no question, answer option, or red-flag rule is
-- touched. The physician reviewed this exact wording in
-- phase5-language-layer-full-set.md (and, for questions carried over
-- unchanged from the first sample, phase5-language-layer-test-set.md)
-- and approved it together with the English content ("as per my
-- revised order along with roman suggestion the draft is approved").
--
-- Two red-flag notes carry the same safety-driven wording change made
-- in 0008: Abdominal pain's "Lower right" option and Urinary symptoms'
-- "fever + side/back pain" option are translated from the corrected,
-- non-diagnosis-naming English text, not the original draft wording
-- that named "appendicitis" / "kidney infection".
--
-- Shortness of Breath and Chest Pain remain untouched here — their
-- English content itself was not approved in 0008, so there is nothing
-- yet for a translation to attach to.

do $$
declare
  mod_id uuid;
  q_id uuid;
begin
  -- ============================================================
  -- Cough
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Cough' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Aapko yeh khansi kitne dinon se hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Aik hafta se kam'
      when 2 then '1 se 3 hafte'
      when 3 then '3 hafton se zyada'
      when 4 then 'Yaqeen nahi'
    end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya khansi ke saath khoon aya hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thora sa, halki si lakeer'
      when 3 then 'Haan, khaasi maqdaar mein'
    end,
    case when position = 3 then 'Khansi ke saath khaasi maqdaar mein khoon anay par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya saans lene mein mushkil hai, ya honth neelay pad rahe hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thori si'
      when 3 then 'Haan, kaafi mushkil hai ya honth neelay hain'
    end,
    case when position = 3 then 'Khansi ke saath saans lene mein shadeed mushkil ya honthon ka neela pan foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya khansi ke saath seenay mein dard hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thora sa'
      when 3 then 'Haan, shadeed ya jakkar jaisa'
    end,
    case when position = 3 then 'Khansi ke saath shadeed ya jakkar jaisa seenay ka dard foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya khansi ke saath tez bukhar aur kapkapi bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Nahi' when 2 then 'Haan' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya pehle se phepray ya dil ki koi bimari hai, ya immune system kamzor hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan — main doctor ko khud bata dunga/dungi' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 7;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Abhi hoshiyari kaisi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Normal'
      when 2 then 'Thakaawat hai magar hosh mein hoon'
      when 3 then 'Bohot neend a rahi hai, confusion hai, ya jagana mushkil hai'
    end,
    case when position = 3 then 'Khansi ke saath hoshiyari kam hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Sore throat
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Sore throat' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Yeh kitne dinon se hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then '3 din se kam' when 2 then '3 se 7 din' when 3 then '7 din se zyada' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya aapko nigalne mein mushkil ho rahi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thori mushkil'
      when 3 then 'Bohot mushkil — apna thook bhi nigal nahi pa raha/rahi'
    end,
    case when position = 3 then 'Apna thook bhi nigal na paana foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya nigalne mein itna dard hai ke lar (thook) tapak rahi hai, ya saans lene mein bhi mushkil ho rahi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Gale ki takleef ke saath lar tapakna ya saans lene mein mushkil foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya bukhar hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Nahi' when 2 then 'Halka' when 3 then 'Tez' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya awaaz mein tabdeeli ai hai (jaise munh mein garam aloo rakha ho), ya gale/gardan ke aik taraf soojan hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Awaaz mein tabdeeli ya gale/gardan ke aik taraf soojan foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya gale ki takleef ke saath jism par rash bhi hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Nahi' when 2 then 'Haan' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Abdominal pain
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Abdominal pain' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Dard kaise shuru hua?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Achanak (pichlay aik ghantay mein)'
      when 2 then 'Aahista, kuch ghanton mein'
      when 3 then 'Aahista, kai dinon mein'
    end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Dard kitna shadeed hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Halka'
      when 2 then 'Darmiyana'
      when 3 then 'Bohot shadeed — zindagi ka sabse zyada tez dard'
    end,
    case when position = 3 then 'Zindagi ke sabse tez dard ki shikayat foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Sabse zyada dard kahan hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Poore pait mein'
      when 2 then 'Pait ke upper hisse mein'
      when 3 then 'Neechay, bayen taraf'
      when 4 then 'Neechay, dayen taraf'
      when 5 then 'Yaqeen nahi'
    end,
    case when position = 4 then 'Pait ke neechay, dayen taraf sabse zyada dard hone par foran jaanch zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya ulti ya paakhane mein khoon aya hai, ya paakhana tar jaisa kaala hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Ulti ya paakhane mein khoon anay ya paakhana kaala hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya pait sakht ya akarha hua hai, ya thori si bhi harkat se dard bohot badh jata hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Pait ka sakht hona ya thori si harkat se shadeed dard hona foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Agar laagu ho — kya aap is waqt hamla hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Yeh laagu nahi hota'
      when 2 then 'Nahi'
      when 3 then 'Haan, aur mujhe yeh dard ho raha hai'
    end,
    case when position = 3 then 'Hamal ke doran yeh dard hona foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 7;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya dard ke saath behoshi ya shadeed chakkar bhi aye hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Dard ke saath behoshi ya shadeed chakkar anay par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 8;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya dard ke saath bukhar bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Nahi' when 2 then 'Haan' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Diarrhea / vomiting
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Diarrhea / vomiting' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Yeh kitne waqt se ho raha hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then '24 ghantay se kam' when 2 then '1 se 3 din' when 3 then '3 din se zyada' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kitni martaba ho raha hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Din mein chand martaba'
      when 2 then 'Din mein kai martaba'
      when 3 then 'Din mein 10 ya us se zyada martaba'
    end,
    case when position = 3 then 'Din mein bohot martaba dast ya ulti hona foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya paakhane ya ulti mein khoon aya hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Paakhane ya ulti mein khoon anay par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya pani ki kami ki alamat hain — bohot kam peshab, chakkar, aankhen dhasi hui, ya shadeed pyaas?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Koi nahi'
      when 2 then 'Halki (pyaas, thora kam peshab)'
      when 3 then 'Shadeed'
    end,
    case when position = 3 then 'Pani ki shadeed kami ki alamat foran tawajjo zaroori hain.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya aap kuch bhi fluids/pani rakh pa rahe hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Haan'
      when 2 then 'Nahi, 24 ghantay se kuch bhi nahi rukh pa raha/rahi'
    end,
    case when position = 2 then '24 ghantay se zyada kuch bhi pet mein na rukna foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya iske saath tez bukhar bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Nahi' when 2 then 'Haan' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 7;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya yeh kisi bachay, buzurg, ya kisi aisay shakhs ke liye hai jisay pehle se koi bimari hai (jaise sugar ya gurdon ki bimari)?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan — main doctor ko khud bata dunga/dungi' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Headache
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Headache' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Yeh kaise shuru hua?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Aahista, mere mamool ke sar dard jaisa'
      when 2 then 'Aahista, magar mamool se zyada shadeed'
      when 3 then 'Achanak, "zindagi ka sabse tez sar dard"'
    end,
    case when position = 3 then 'Achanak shuru hone wala aur zindagi ka sabse tez sar dard foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya sar dard ke saath bukhar aur gardan ki akarhat bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Sar dard ke saath bukhar aur gardan ki akarhat foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya nazar mein tabdeeli, jism ke aik taraf kamzori ya sunn pan, confusion, ya baat karne mein lakhnat (ruk ruk kar baat) hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Nazar mein tabdeeli, jism ke aik taraf kamzori ya sunn pan, confusion, ya baat mein lakhnat foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya yeh sar par chot lagne ke baad shuru hua?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Haan, halki chot'
      when 3 then 'Haan, shadeed chot'
    end,
    case when position = 3 then 'Sar par shadeed chot ke baad sar dard foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Yeh pehle wale sar dard (jaise migraine) se kaisa mukhtalif hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Yeh mera mamool ka pattern hai' when 2 then 'Yeh naya ya mukhtalif hai' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Back pain
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Back pain' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya peshab ya paakhana par control kho gaya hai, ya taangon ke darmiyan/upri hisse mein sunn pan mehsoos hua hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Peshab ya paakhana par control khona, ya groin mein sunn pan, foran (urgent) tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya aik ya dono taangon mein kamzori ya sunn pan hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Taangon mein kamzori ya sunn pan foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya yeh chot lagne ya girne ke baad shuru hua?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan, halki chot' when 3 then 'Haan, shadeed chot' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya kamar dard ke saath bukhar bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Kamar dard ke saath bukhar foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya pehle kabhi cancer hua hai, ya hal hi mein bila wajah wazan kam hua hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan — main doctor ko khud bata dunga/dungi' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Dard kitna shadeed hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Halka' when 2 then 'Darmiyana' when 3 then 'Shadeed' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Urinary symptoms
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Urinary symptoms' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Peshab karte waqt jalan ya dard hota hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman', case position when 1 then 'Bilkul nahi' when 2 then 'Thora sa' when 3 then 'Shadeed' end, 'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya peshab mein khoon nazar aya hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Peshab mein khoon nazar anay par foran jaanch zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya iske saath bukhar aur kamar/pehlu mein dard bhi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Bukhar ke saath kamar ya pehlu mein dard foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya aap bilkul peshab nahi kar pa rahe/rahi?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Nahi, peshab theek tarah ho raha hai'
      when 2 then 'Haan, bilkul peshab nahi ho raha'
    end,
    case when position = 2 then 'Bilkul peshab na hona foran (urgent) tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Agar laagu ho — kya aap is waqt hamla hain?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Yeh laagu nahi hota' when 2 then 'Nahi' when 3 then 'Haan' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- ============================================================
  -- Other
  -- ============================================================
  select id into mod_id from public.clinical_modules
  where complaint = 'Other' and status = 'approved' order by version desc limit 1;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Aap iski shiddat (severity) kitni bataingay?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Halka'
      when 2 then 'Darmiyana'
      when 3 then 'Shadeed — jitna bura maine kabhi mehsoos nahi kiya'
    end,
    case when position = 3 then 'Zindagi ka sabse bura mehsoos hona foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya aapko saans lene mein mushkil, seenay mein dard, confusion, na rukne wala khoon bahna, ya behoshi ho rahi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Nahi' when 2 then 'Haan' end,
    case when position = 2 then 'Saans lene mein mushkil, seenay mein dard, confusion, na rukne wala khoon bahna, ya behoshi foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  select id into q_id from public.clinical_questions where module_id = mod_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Yeh kitne waqt se ho raha hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position when 1 then 'Aik din se kam' when 2 then 'Chand din' when 3 then 'Aik hafta ya zyada' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;
end $$;
