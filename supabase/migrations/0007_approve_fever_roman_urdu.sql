-- Phase 5: approve Roman Urdu for Fever.
--
-- Fever's English clinical content is already approved and live
-- (0005). This adds its Roman Urdu translation as approved content —
-- the physician reviewed this exact wording in
-- phase5-language-layer-full-set.md. No clinical meaning changes: same
-- questions, same answer options, same red flags — only the wording a
-- patient who picks Roman Urdu will see.
--
-- The other ten complaint modules are NOT touched here. Their English
-- clinical content itself is still only drafted, not approved — a
-- separate decision from language wording — so there is nothing yet
-- for a translation to attach to. Shortness of Breath and Chest Pain
-- are additionally still pending the physician's questionnaire-vs-
-- immediate-emergency-message decision.

do $$
declare
  fever_module_id uuid;
  q_id uuid;
begin
  select id into fever_module_id
  from public.clinical_modules
  where complaint = 'Fever' and status = 'approved'
  order by version desc
  limit 1;

  -- Consent (shared across all complaints, not Fever-specific).
  insert into public.consent_versions (version, language, body, status, approved_by, approved_at)
  values (
    1,
    'ur-roman',
    'Shuru karne se pehle: yeh mukhtasar sawalat aapki takleef ko tarteeb dene mein madad karte hain taake aapka doctor asani se dekh sakay. Yeh koi tashkhees (diagnosis) nahi hai, aur na hi yeh doctor se baat karne ka matdal (substitute) hai — aapka doctor har jawab dekhne ke baad hi koi medical faisla karega. Agar koi jawab yeh zahir kare ke aapko foran ilaj ki zaroorat ho sakti hai, to hum aapko saaf tor par bata denge aur mashwara denge ke is consultation ka intezaar karne ke bajaye foran ilaj hasil karein. Agar aapko lagta hai ke abhi yeh ek medical emergency hai, to intezaar na karein — foran emergency se rabta karein.

Aagay barh kar, aap razi ho rahe hain ke jitna ho sake theek tareeqay se jawab denge, yeh samajhtay hue ke yeh aapke doctor ki madad ke liye aik zariya hai — unke faislay ka matdal nahi.',
    'approved',
    'Zayn',
    now()
  );

  -- Q1
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 1;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Bukhar kab shuru hua?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then 'Aaj'
      when 2 then 'Aik do din pehle'
      when 3 then 'Teen se paanch din pehle'
      when 4 then 'Paanch din se zyada'
      when 5 then 'Yaqeen nahi'
    end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q2
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 2;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Agar aapne check kiya hai, to sabse zyada temperature kitna tha?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id, 'ur-roman',
    case position
      when 1 then '100°F se kam'
      when 2 then '100–102°F'
      when 3 then '102°F se zyada'
      when 4 then 'Check nahi kiya'
    end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q3 (red flag on option 3)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 3;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya saans lene mein mushkil hai, ya saans mamool se bohot tez chal rahi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thori si'
      when 3 then 'Haan, kaafi mushkil ho rahi hai'
    end,
    case when position = 3 then 'Bukhar ke saath saans lene mein shadeed mushkil hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q4 (red flag on option 3)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 4;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Bukhar ke saath, kya gardan mein akarhat, shadeed sar dard, ya roshni se takleef ho rahi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Sirf halka sar dard'
      when 3 then 'Haan, gardan akarhi hai aur/ya roshni se takleef hai'
    end,
    case when position = 3 then 'Bukhar ke saath gardan ki akarhat ya roshni se takleef hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q5 (red flag on option 3)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 5;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Baar baar ulti ho rahi hai ya pani ki kami ki alamat hain — jaise bohot kam peshab, chakkar, ya kuch bhi pet mein na rukna?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Thori ulti ho rahi hai magar kuch cheezein rukk rahi hain'
      when 3 then 'Haan, kuch bhi rukk nahi raha'
    end,
    case when position = 3 then 'Bukhar ke saath agar kuch bhi pet mein na ruke to foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q6 (red flag on option 2)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 6;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya jism par koi rash hai jo dabane se mit na ho, ya jild ka rang ghair mamooli pila, neela, ya grey ho gaya hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Haan'
    end,
    case when position = 2 then 'Bukhar ke saath aisa rash ya jild ke rang mein tabdeeli hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q7 (red flag on option 2)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 7;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Kya yeh bukhar 3 maheenay se kam umar ke bachay ko hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Yeh laagu nahi hoti'
      when 2 then 'Haan, yeh bacha 3 maheenay se kam umar ka hai'
    end,
    case when position = 2 then '3 maheenay se kam umar ke bachay ko bukhar hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q8 (red flag on option 3)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 8;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Abhi hoshiyari kaisi hai?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, red_flag_note_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Normal'
      when 2 then 'Thakaawat hai magar hosh mein hoon'
      when 3 then 'Bohot neend a rahi hai, confusion hai, ya jagana mushkil hai'
    end,
    case when position = 3 then 'Bukhar ke saath hoshiyari kam hone par foran tawajjo zaroori hai.' end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;

  -- Q9 (no red flag)
  select id into q_id from public.clinical_questions where module_id = fever_module_id and position = 9;
  insert into public.question_translations (question_id, language, wording_text, status, reviewer, approved_at)
  values (q_id, 'ur-roman', 'Koi aur baat jo zaroori ho — hal hi mein safar, kisi mutadi bimari ka exposure, ya pehle se sugar, dil/phepray ki bimari, ya kamzor immune system?', 'approved', 'Zayn', now());
  insert into public.answer_option_translations (answer_option_id, language, label_text, status, reviewer, approved_at)
  select id,
    'ur-roman',
    case position
      when 1 then 'Nahi'
      when 2 then 'Haan — main doctor ko khud bata dunga/dungi'
    end,
    'approved', 'Zayn', now()
  from public.clinical_answer_options where question_id = q_id;
end $$;
