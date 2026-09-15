-- One-time pre-launch cleanup (2026-09-15) — NOT a migration, never runs
-- automatically, and is not part of the numbered supabase/migrations/
-- chain. Every test account made while building and testing this app —
-- patients, doctors, and anything they created (bookings, messages,
-- prescriptions, payments, payouts, feedback) — lives in the same one
-- real Supabase project the live site will use; there was never a
-- separate test/production database. This script removes all of that,
-- keeping ONLY whatever's in admin_profiles (every admin account the
-- physician deliberately created — there's no self-registration route
-- for admin, so every row there was made on purpose).
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
--
-- WHAT THIS DOES NOT TOUCH: admin_profiles and their auth.users rows
-- (every admin account); platform_default_text_hours (global config,
-- not tied to any account); sponsored_ads (a sponsor isn't a user
-- account at all — its created_by column just gets set to NULL, which
-- is already how the schema handles an admin being removed).
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
-- with a foreign-key error.

begin;

-- 1. Everything that hangs off a consultation.
delete from public.consultation_messages;
delete from public.consultation_medications;
delete from public.consultation_assessments;
delete from public.consultation_followups;
delete from public.payments;

-- 2. Direct-to-account tables with no cascade at all.
delete from public.patient_feedback;
delete from public.doctor_payouts;
delete from public.doctor_subscription_events;

-- 3. Consultations themselves (safe now — nothing above references them
--    anymore).
delete from public.consultations;

-- 4. Doctor-owned scheduling data (safe now — no consultation still
--    points at a slot).
delete from public.doctor_availability_slots;

-- 5. Family member records (would cascade automatically once the owning
--    account is deleted below, but deleting explicitly here keeps every
--    step in this script equally easy to audit).
delete from public.family_members;

-- 6. The accounts themselves — this is the one statement that actually
--    removes people. Cascades automatically from here into
--    doctor_profiles and doctor_text_availability (both ON DELETE
--    CASCADE from auth.users — family_members is already cleared above,
--    so its own cascade never has anything left to do), and sets
--    sponsored_ads.created_by to NULL for any ad an about-to-be-deleted
--    doctor account happened to create. Every admin_profiles row (and
--    its auth.users row) is explicitly excluded.
delete from auth.users
where id not in (select id from public.admin_profiles);

-- Verification output — read this before deciding whether to commit.
do $$
declare
  remaining_users int;
  remaining_admins int;
  remaining_family_members int;
  remaining_doctors int;
  remaining_consultations int;
begin
  select count(*) into remaining_users from auth.users;
  select count(*) into remaining_admins from public.admin_profiles;
  select count(*) into remaining_family_members from public.family_members;
  select count(*) into remaining_doctors from public.doctor_profiles;
  select count(*) into remaining_consultations from public.consultations;

  raise notice 'auth.users remaining: % (should equal admin count)', remaining_users;
  raise notice 'admin_profiles remaining: %', remaining_admins;
  raise notice 'family_members remaining: % (should be 0 — this is where patient/family data lives since migration 0003)', remaining_family_members;
  raise notice 'doctor_profiles remaining: % (should be 0)', remaining_doctors;
  raise notice 'consultations remaining: % (should be 0)', remaining_consultations;
end $$;

commit;
