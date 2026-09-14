-- Doctor onboarding, step 1: self-service registration + PMDC
-- verification foundation. Scoped with the physician (2026-09-14) after
-- he raised a real operational problem: five doctors are lined up to
-- join, and admin-inviting each one by hand (the only path that existed
-- until now, 0026) doesn't scale the way a self-serve "apply to join"
-- page does.
--
-- What this migration deliberately does NOT do yet, on purpose, each
-- flagged as its own next step rather than folded in here:
-- 1. It does not touch the fixed PKR 500 consultation fee, the payment
--    route, or the doctor payout split (0026's 350/150). A doctor's
--    OWN requested fee is captured and gated here, but nothing in the
--    live booking/payment flow reads it yet — that's a deliberate
--    payment-logic change (Section 38) planned as its own step, not
--    bundled into an onboarding migration.
-- 2. It does not add multi-doctor booking (patients choosing a doctor
--    by department) — booking still auto-assigns via 0015's
--    single-doctor trigger for now.
-- 3. It does not build the actual terms-of-engagement legal wording —
--    the physician asked Claude to draft a first version for his
--    review, same as clinical consent content always has been; nothing
--    gets shown to a real doctor as final until he approves it, and
--    `engagement_agreement_accepted_at` here is just the column that
--    will record a doctor's acceptance once that text exists.
--
-- Confirmed with the physician before writing this: the platform's
-- share of a doctor-set consultation fee is 150 (fee <= 900), 200
-- (901-1200), 250 (1201-1500); anything above 1500 needs a separate,
-- explicit admin approval on top of PMDC approval. A doctor cannot
-- request a fee below PKR 500 (matches today's patient-facing baseline
-- — no race-to-the-bottom pricing). This migration only stores the
-- doctor's requested fee and whether it's cleared to go live
-- (`fee_status`) — the actual tier arithmetic lives in application code
-- (src/lib/platformFee.ts) so it can be reused by the payment route
-- once that step is built, rather than being duplicated later.

-- 1. New columns on doctor_profiles. Every one of these is nullable or
--    has a safe default so this is purely additive — no existing row's
--    current behavior changes from this ALTER alone.
alter table public.doctor_profiles
  add column if not exists specialty text,
  add column if not exists pmdc_number text,
  add column if not exists pmdc_certificate_path text,
  add column if not exists verification_status text not null default 'pending_review',
  add column if not exists rejection_reason text,
  add column if not exists consultation_fee int,
  add column if not exists fee_status text not null default 'not_set',
  add column if not exists engagement_agreement_accepted_at timestamptz;

alter table public.doctor_profiles
  add constraint doctor_profiles_verification_status_check
  check (verification_status in ('pending_review', 'approved', 'rejected'));

alter table public.doctor_profiles
  add constraint doctor_profiles_fee_status_check
  check (fee_status in ('not_set', 'approved', 'pending_admin_approval'));

alter table public.doctor_profiles
  add constraint doctor_profiles_consultation_fee_check
  check (consultation_fee is null or consultation_fee >= 500);

-- 2. One-time grandfather backfill. The ALTER above defaults every row
--    — including doctors who already existed before self-registration
--    was ever a thing — to 'pending_review'/'not_set', which would lock
--    the physician's own existing doctor account out of /doctor the
--    moment the app-layer approval gate (next step) goes live. This
--    UPDATE runs once, immediately after adding the columns, and only
--    ever affects rows that exist at the moment this migration is run
--    — any doctor who self-registers afterwards goes through the real
--    pending_review path, untouched by this statement.
update public.doctor_profiles
set
  verification_status = 'approved',
  specialty = coalesce(specialty, 'Family Medicine'),
  consultation_fee = coalesce(consultation_fee, 500),
  fee_status = 'approved',
  engagement_agreement_accepted_at = coalesce(engagement_agreement_accepted_at, created_at)
where verification_status = 'pending_review';

-- 3. Private storage bucket for scanned PMDC certificates. No storage
--    RLS policies are added — deliberately. The only two things that
--    ever touch this bucket are the new registration API route (writes,
--    using the service-role key) and a new admin-only API route that
--    hands back a short-lived signed URL to view one (reads, same
--    service-role key) — both routes re-verify the caller themselves
--    before touching storage, the same pattern as every other
--    privileged route in this app (Daily.co room, payment, admin doctor
--    invite). With no policies and a private bucket, Postgres/Supabase
--    Storage denies every anon/authenticated request outright by
--    default — there is nothing here for a browser to reach directly.
insert into storage.buckets (id, name, public)
values ('doctor-documents', 'doctor-documents', false)
on conflict (id) do nothing;

-- No new RLS policy is needed on doctor_profiles itself for any of
-- this: the existing "Admins can update doctor profiles" policy (0026)
-- already allows an admin to write every column on this table,
-- including the new ones, with no column-level narrowing — this was
-- checked before writing this migration, not assumed. Self-registration
-- happens through a service-role API route (bypasses RLS by design, so
-- the public registration form never needs its own INSERT policy or
-- column grant), and a doctor's existing "view their own profile"
-- SELECT policy (0015) already returns every column on their own row,
-- including their verification status.
