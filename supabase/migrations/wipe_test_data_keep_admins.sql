-- One-time pre-launch cleanup (2026-09-15, revised 2026-09-27, revised
-- again same day) — NOT a migration, never runs automatically, and is
-- not part of the numbered supabase/migrations/ chain. Every test
-- account made while building and testing this app — patients,
-- doctors, and anything they created (bookings, messages,
-- prescriptions, payments, payouts, feedback, uploaded reports,
-- follow-up vouchers, subscription proofs, agreement acceptances) —
-- lives in the same one real Supabase project the live site will use;
-- there was never a separate test/production database. This script
-- removes all of that, keeping ONLY:
--   1. Every account in admin_profiles (every admin account the
--      physician deliberately created).
--   2. ONE specific patient account, by email (see PRESERVED_PATIENT_EMAIL
--      just below) — physician's own request, 2026-09-27: "adjust script
--      now to keep Ahmed Profile from patients so i can keep reviewing
--      updated from patient perspective."
--
-- *** THE EMAIL TO PRESERVE IS SET IN EXACTLY TWO PLACES BELOW, EACH ***
-- *** MARKED "PRESERVED_PATIENT_EMAIL" — CHANGE BOTH IF YOU EVER WANT ***
-- *** TO KEEP A DIFFERENT PATIENT INSTEAD.                            ***
--
-- What "preserved" means for this one patient, precisely: their LOGIN
-- (auth.users row) and their FAMILY MEMBER LIST (every row in
-- family_members under their account — not just themselves, so a
-- spouse/child they'd already added stays too) survive. Their OLD
-- consultations, prescriptions, messages, payments, uploaded documents,
-- and any feedback/vouchers tied to those old consultations do NOT
-- survive — those get cleared the same as every other test account's,
-- for one deliberate reason: every one of those old records was handled
-- by a test DOCTOR account, and this script still wipes every doctor
-- (per your own instruction — new real doctors register fresh through
-- /doctor/register from here on, per Section 43). Keeping this patient's
-- old consultation history would mean it points at a doctor_id that no
-- longer exists, which Postgres won't allow (a real foreign-key error,
-- the same category of bug already found and fixed once in this
-- script — see the 2026-09-27 revision note below). So this script
-- keeps the LOGIN + FAMILY LIST (so you don't have to re-register or
-- re-add family members every time you want to test as a patient), and
-- clears the historical clinical data (so nothing is left pointing at a
-- doctor account that's about to be deleted). After running this, you
-- can log in as this patient and book a brand-new test consultation
-- with whichever real doctor you register next, any time you want to
-- keep reviewing the app from a patient's point of view.
--
-- Revised 2026-09-27 (earlier the same day): the original version of
-- this script (2026-09-15) predates several tables added since
-- (migrations 0038-0044, 0047) that reference auth.users, family_members,
-- or consultations directly. Three of them (consultation_followup_vouchers,
-- patient_documents, doctor_agreement_acceptances) do NOT cascade on
-- delete, so the original script would have failed partway through with
-- a foreign-key error the first time it was actually run against
-- today's real schema — this revision adds explicit clears for all
-- three before anything else, guarded so the script still runs cleanly
-- even if one of those migrations somehow hasn't been applied yet on
-- your project. (Proved with a real, running test database — see the
-- physician's copy of this project's own checklist, Section 43, for the
-- before/after test results.)
--
-- HOW TO RUN THIS:
-- 1. Back up first. In the Supabase dashboard: Database -> Backups (or
--    Settings -> Database -> "Download backup") before running this —
--    this script is NOT reversible once committed.
-- 2. Open the SQL Editor in the Supabase dashboard, paste this whole
--    file, and run it. It's wrapped in its own transaction, so if
--    anything in it errors, nothing is changed — but read the NOTICE
--    output at the end either way to see exactly what's left.
-- 3. Do this once, right before real patients start using the site —
--    not before you're done testing, since running it deletes every
--    doctor account too (including any doctor you've registered for
--    real but haven't gone live with yet). If you have a real doctor
--    account you want to KEEP, tell Claude before running this so the
--    script can be adjusted to exclude specific accounts by id/email
--    rather than wiping every non-admin row.
-- 4. This script only clears DATABASE ROWS — it cannot delete files
--    already sitting in Supabase Storage (PMDC/CNIC certificates,
--    uploaded health-record reports, subscription payment-proof
--    receipts). Those buckets are private, so nothing public is exposed
--    by leaving old test files in them, but if you also want the
--    storage buckets fully empty, that's a separate manual step in the
--    Supabase dashboard: Storage -> each bucket (doctor-certificates,
--    doctor-cnic, patient-documents, doctor-subscription-proofs,
--    consultation-attachments) -> select all -> delete. Optional, not
--    required for a correct launch. This includes any document your
--    preserved patient uploaded before this run — the database row
--    goes, the file in Storage does not; harmless to leave, or delete
--    it yourself in the Storage tab if you'd rather it be gone too.
--
-- WHAT THIS DOES NOT TOUCH: admin_profiles and their auth.users rows
-- (every admin account); the one preserved patient's auth.users row and
-- their family_members rows (see above); platform_default_text_hours and
-- platform_settings (global config, not tied to any account —
-- platform_settings holds your bank/JazzCash payment-instructions text,
-- Section 23, which you'd have to retype if this were cleared);
-- sponsored_ads (a sponsor isn't a user account at all — its created_by
-- column just gets set to NULL, which is already how the schema handles
-- an admin being removed); contact_messages (fully anonymous submissions
-- with no account reference at all — Section 28 — so there's nothing
-- here for this script to find or clear; if you want old test inquiries
-- gone, that's a manual delete in the Table Editor); site_page_views
-- (anonymous traffic analytics, no account reference either).
--
-- Explicit, ordered deletes rather than relying purely on cascades —
-- easier to read and audit than trusting a long chain of ON DELETE
-- CASCADE to resolve in the right order, even though most of these
-- tables would eventually cascade away on their own once the owning
-- auth.users row is deleted. A few tables (patient_feedback,
-- doctor_payouts, doctor_availability_slots, doctor_subscription_events)
-- reference auth.users directly with NO cascade at all (by original
-- design — see each migration's own comments), so those MUST be cleared
-- before auth.users rows can be deleted at all, or Postgres will refuse
-- with a foreign-key error. The three tables called out in the revision
-- note above are the same situation, just added later.

begin;

-- 0. Newer tables (added after this script was first written) that
--    reference auth.users/family_members/consultations WITHOUT a
--    cascade, and so must be cleared before those rows can be deleted.
--    Cleared unconditionally (not scoped to the preserved patient) —
--    every row in these three tables that could involve the preserved
--    patient was created by, or references, a test DOCTOR account that
--    this script still deletes below, so none of it can be kept without
--    also keeping that doctor (not what was asked for). Each is wrapped
--    in a to_regclass() check so this script still runs cleanly if, for
--    any reason, one of these migrations hasn't been applied on your
--    project yet — in that case the check just skips it rather than
--    erroring the whole script out.
do $$
begin
  if to_regclass('public.consultation_followup_vouchers') is not null then
    execute 'delete from public.consultation_followup_vouchers';
  end if;
  if to_regclass('public.patient_documents') is not null then
    execute 'delete from public.patient_documents';
  end if;
  if to_regclass('public.doctor_agreement_acceptances') is not null then
    execute 'delete from public.doctor_agreement_acceptances';
  end if;
  if to_regclass('public.doctor_subscription_payment_proofs') is not null then
    execute 'delete from public.doctor_subscription_payment_proofs';
  end if;
  -- Pure test-run log rows, not blocking anything (payment_id/resolved_by
  -- both already SET NULL on delete) — cleared anyway since every row in
  -- here today is from a sandbox test payment, not a real one.
  if to_regclass('public.payment_webhook_issues') is not null then
    execute 'delete from public.payment_webhook_issues';
  end if;
end $$;

-- 1. Everything that hangs off a consultation. Unscoped (not filtered to
--    the preserved patient) — see the note above on why their OLD
--    consultation history is cleared along with everyone else's.
delete from public.consultation_messages;
delete from public.consultation_medications;
delete from public.consultation_assessments;
delete from public.consultation_followups;
delete from public.payments;

-- 2. Direct-to-account tables with no cascade at all. Also unscoped —
--    same reasoning (patient_feedback.doctor_id would otherwise block
--    deleting the doctor it references).
delete from public.patient_feedback;
delete from public.doctor_payouts;
delete from public.doctor_subscription_events;

-- 3. Consultations themselves (safe now — nothing above references them
--    anymore). Unscoped — the preserved patient's OLD consultations go
--    too, per the note above; a fresh one can be booked after this run.
delete from public.consultations;

-- 4. Doctor-owned scheduling data (safe now — no consultation still
--    points at a slot).
delete from public.doctor_availability_slots;

-- 5. Family member records — THE FIRST OF THE TWO PLACES THE PRESERVED
--    PATIENT IS EXCLUDED. Everyone else's family_members rows are
--    cleared explicitly (they'd also cascade once their account is
--    deleted below, but doing it here keeps every step equally easy to
--    audit); the preserved patient's are deliberately skipped, so their
--    full family list (not just themselves) survives.
delete from public.family_members
where account_id not in (
  select id from auth.users where email = 'ahmedtest01@example.com'  -- PRESERVED_PATIENT_EMAIL
);

-- 6. The accounts themselves — this is the one statement that actually
--    removes people, and THE SECOND OF THE TWO PLACES THE PRESERVED
--    PATIENT IS EXCLUDED. Cascades automatically from here into
--    doctor_profiles and doctor_text_availability (both ON DELETE
--    CASCADE from auth.users — family_members is already cleared above,
--    so its own cascade never has anything left to do), and sets
--    sponsored_ads.created_by to NULL for any ad an about-to-be-deleted
--    doctor account happened to create. Every admin_profiles row, and
--    the one preserved patient's row, are explicitly excluded.
delete from auth.users
where id not in (select id from public.admin_profiles)
  and email is distinct from 'ahmedtest01@example.com';  -- PRESERVED_PATIENT_EMAIL

-- Verification output — read this before deciding whether to commit.
do $$
declare
  remaining_users int;
  remaining_admins int;
  remaining_family_members int;
  remaining_doctors int;
  remaining_consultations int;
  remaining_vouchers int := 0;
  remaining_documents int := 0;
  remaining_agreement_acceptances int := 0;
  preserved_patient_found boolean;
  preserved_patient_family_count int;
begin
  select count(*) into remaining_users from auth.users;
  select count(*) into remaining_admins from public.admin_profiles;
  select count(*) into remaining_family_members from public.family_members;
  select count(*) into remaining_doctors from public.doctor_profiles;
  select count(*) into remaining_consultations from public.consultations;

  select exists(select 1 from auth.users where email = 'ahmedtest01@example.com')
    into preserved_patient_found;
  select count(*) into preserved_patient_family_count
    from public.family_members fm
    join auth.users u on u.id = fm.account_id
    where u.email = 'ahmedtest01@example.com';

  if to_regclass('public.consultation_followup_vouchers') is not null then
    execute 'select count(*) from public.consultation_followup_vouchers' into remaining_vouchers;
  end if;
  if to_regclass('public.patient_documents') is not null then
    execute 'select count(*) from public.patient_documents' into remaining_documents;
  end if;
  if to_regclass('public.doctor_agreement_acceptances') is not null then
    execute 'select count(*) from public.doctor_agreement_acceptances' into remaining_agreement_acceptances;
  end if;

  raise notice 'auth.users remaining: % (should equal admin count, plus 1 if the preserved patient was found)', remaining_users;
  raise notice 'admin_profiles remaining: %', remaining_admins;
  raise notice 'PRESERVED PATIENT (ahmedtest01@example.com) found and kept: %', preserved_patient_found;
  raise notice 'PRESERVED PATIENT''s family_members remaining: % (their full family list — should be >= 1 if found)', preserved_patient_family_count;
  raise notice 'family_members remaining overall: % (should equal the preserved patient''s own family count above, 0 if not found)', remaining_family_members;
  raise notice 'doctor_profiles remaining: % (should be 0 — every doctor is wiped, including any one who treated the preserved patient before)', remaining_doctors;
  raise notice 'consultations remaining: % (should be 0 — including the preserved patient''s own OLD consultations, see the header note on why)', remaining_consultations;
  raise notice 'consultation_followup_vouchers remaining: % (should be 0)', remaining_vouchers;
  raise notice 'patient_documents remaining: % (should be 0 — the underlying uploaded files stay in Storage; see note 4 above)', remaining_documents;
  raise notice 'doctor_agreement_acceptances remaining: % (should be 0)', remaining_agreement_acceptances;
end $$;

commit;
