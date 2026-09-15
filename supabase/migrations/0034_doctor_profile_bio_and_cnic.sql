-- Doctor public profile (bio, years of experience, photo), plus a CNIC
-- identity check (2026-09-15). The physician reviewed the site preview
-- and flagged that "Meet your doctor" is still a bracketed placeholder
-- — this was already known and flagged as a future item (2026-09-14
-- redesign entry: "a real doctor-profile feature... will need real
-- schema fields (bio, specialty, years of practice, photo)"). Confirmed
-- with the physician before building: a doctor submits their own bio/
-- experience/photo, but it only goes public after admin approval — the
-- same "admin decides what represents the clinic publicly" model
-- already used for PMDC verification and fee approval — and, his own
-- addition, a scanned CNIC (Pakistan's national ID card) is required
-- alongside it as an extra identity check, on top of the PMDC
-- certificate already collected at registration.
--
-- Design decisions made here, stated explicitly rather than left
-- implicit:
-- 1. CNIC applies to every doctor, not just new applicants — an
--    already-approved doctor from before this feature existed has no
--    CNIC on file, so submitting a profile (bio/photo) for the first
--    time is also the moment they're asked to add their CNIC, handled
--    entirely in application code (the doctor's own profile-submission
--    form requires it whenever cnic_certificate_path is still null) —
--    no separate migration or grandfather backfill needed for this,
--    unlike PMDC status in 0027, since nothing here changes who's
--    currently able to log in or be booked.
-- 2. The CNIC scan is exactly as sensitive as a PMDC certificate (more,
--    really — it's a government identity document) so it lives in the
--    same private "doctor-documents" bucket (0027), same zero-policy/
--    API-route-only access pattern, not anywhere public.
-- 3. A profile photo is the opposite case — it has to be publicly
--    viewable on the doctor directory, so it gets its own PUBLIC
--    storage bucket rather than reusing the private one. Nothing
--    sensitive is stored there, just an image a doctor chose to show
--    patients.
-- 4. A doctor's bio/years/photo are written through a new
--    service-role API route (like registration itself), never a direct
--    client UPDATE — doctor_profiles still has zero doctor-facing RLS
--    UPDATE policies at all (checked again here, still true), which is
--    exactly what already makes fields like daily_patient_cap and
--    custom_platform_share admin-only; keeping bio/photo writes routed
--    through an API means that invariant never has to be touched or
--    special-cased just for this feature.
-- 5. A pending or rejected profile is invisible to patients — the
--    public directory view only ever returns bio/years/photo once
--    profile_status = 'approved', the same "not live until approved"
--    principle as verification_status and fee_status.

-- 1. New columns. All nullable / safe-defaulted — purely additive, no
--    existing row's current behavior changes.
alter table public.doctor_profiles
  add column if not exists cnic_number text,
  add column if not exists cnic_certificate_path text,
  add column if not exists bio text,
  add column if not exists years_of_experience int,
  add column if not exists profile_photo_url text,
  add column if not exists profile_status text not null default 'not_submitted',
  add column if not exists profile_rejection_reason text;

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_profile_status_check;
alter table public.doctor_profiles
  add constraint doctor_profiles_profile_status_check
  check (profile_status in ('not_submitted', 'pending_review', 'approved', 'rejected'));

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_years_of_experience_check;
alter table public.doctor_profiles
  add constraint doctor_profiles_years_of_experience_check
  check (years_of_experience is null or years_of_experience >= 0);

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_bio_length_check;
alter table public.doctor_profiles
  add constraint doctor_profiles_bio_length_check
  check (bio is null or char_length(bio) <= 1000);

-- 2. Public storage bucket for profile photos — deliberately public,
--    unlike doctor-documents. Still only ever written by a service-role
--    API route (a doctor never gets direct storage write access), but
--    reads don't need to be gated at all since the photo itself isn't
--    sensitive.
insert into storage.buckets (id, name, public)
values ('doctor-photos', 'doctor-photos', true)
on conflict (id) do nothing;

-- 3. Extend the public directory view (0028) with the three profile
--    fields, gated by profile_status = 'approved' — a doctor who hasn't
--    submitted, or is still pending/rejected, still shows up in the
--    directory (name/specialty/fee, as before) but with no bio/years/
--    photo until their submission is actually approved. CREATE OR
--    REPLACE VIEW can append new output columns without dropping the
--    view, so its existing grants survive untouched.
create or replace view public.public_doctor_directory as
select
  id,
  full_name,
  specialty,
  consultation_fee,
  case when profile_status = 'approved' then bio end as bio,
  case when profile_status = 'approved' then years_of_experience end as years_of_experience,
  case when profile_status = 'approved' then profile_photo_url end as profile_photo_url
from public.doctor_profiles
where verification_status = 'approved' and is_active and fee_status = 'approved';

grant select on public.public_doctor_directory to anon, authenticated;

-- No RLS or grant change needed on doctor_profiles itself: admin's
-- existing "Admins can update doctor profiles" policy (0026) already
-- covers every column including these new ones (no column narrowing),
-- so approving/rejecting a profile submission just works; and since no
-- doctor-facing UPDATE policy exists on this table at all (confirmed
-- again here), a doctor's own bio/photo/CNIC submission can only ever
-- happen through the new API route below, using the service-role key —
-- never a direct client write.
