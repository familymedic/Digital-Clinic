-- 0067: doctor credentials (MBBS, BDS, RMP, MCPS, FCPS, ...) — 2026-10-08.
--
-- Physician's rule: a doctor REQUESTS a credential; it is only shown to
-- patients once an admin approves it.
--   * MBBS / BDS / RMP: no extra evidence — the admin checks them against
--     the PMDC certificate the doctor already submitted at registration.
--   * MCPS / FCPS / other postgraduate qualifications: the doctor must
--     upload evidence (the certificate awarded by CPSP, or a PMDC
--     registration showing the updated postgraduate qualification).
-- An admin can remove an approved credential at any time.
--
-- Which credentials exist, and which need evidence, is defined in
-- src/lib/credentials.ts — deliberately NOT a database constraint, so
-- adding one later is a one-line edit, no migration.
--
-- Evidence files live in the existing private "doctor-documents" bucket
-- (same as the PMDC certificate and CNIC): zero storage policies, reached
-- only through server routes. Doctors never write this table directly —
-- requests go through /api/doctors/credentials (service role, caller's own
-- row only). Doctors can READ their own rows; admins can read and update all.

create table if not exists public.doctor_credentials (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  credential text not null,
  detail text,                       -- optional subject, e.g. "Paediatrics"
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'removed')),
  evidence_path text,                -- private storage path; null for PMDC-verified ones
  rejection_reason text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint doctor_credentials_detail_length check (detail is null or char_length(detail) <= 40),
  constraint doctor_credentials_credential_length check (char_length(credential) between 2 and 20)
);

-- A doctor can't have the same credential (+subject) pending or approved twice.
create unique index if not exists doctor_credentials_one_active_idx
  on public.doctor_credentials (doctor_id, credential, coalesce(detail, ''))
  where status in ('pending_review', 'approved');

create index if not exists doctor_credentials_status_idx
  on public.doctor_credentials (status, requested_at desc);
create index if not exists doctor_credentials_doctor_idx
  on public.doctor_credentials (doctor_id);

alter table public.doctor_credentials enable row level security;

drop policy if exists "Doctors can view their own credentials" on public.doctor_credentials;
create policy "Doctors can view their own credentials"
  on public.doctor_credentials for select
  using (doctor_id = auth.uid());

drop policy if exists "Admins can view all credentials" on public.doctor_credentials;
create policy "Admins can view all credentials"
  on public.doctor_credentials for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update credentials" on public.doctor_credentials;
create policy "Admins can update credentials"
  on public.doctor_credentials for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Public directory: add one appended column, `credentials`, holding ONLY
-- approved credentials as a ready-to-display string, e.g.
-- "MBBS, RMP, FCPS (Paediatrics)". Every existing column keeps its name,
-- type and position, so nothing that already uses this view (directory,
-- doctor page, availability function, prescription PDF) is affected.
create or replace view public.public_doctor_directory as
select
  d.id,
  d.full_name,
  d.specialty,
  d.consultation_fee,
  case when d.profile_status = 'approved' then d.bio end as bio,
  case when d.profile_status = 'approved' then d.years_of_experience end as years_of_experience,
  case when d.profile_status = 'approved' then d.profile_photo_url end as profile_photo_url,
  (
    select string_agg(
      c.credential || case when coalesce(c.detail, '') <> '' then ' (' || c.detail || ')' else '' end,
      ', '
      order by coalesce(
        array_position(
          array['MBBS','BDS','RMP','MD','MS','MDS','MCPS','FCPS','MRCP','FRCP','MRCGP','FRCS']::text[],
          c.credential
        ), 99),
        c.credential
    )
    from public.doctor_credentials c
    where c.doctor_id = d.id and c.status = 'approved'
  ) as credentials
from public.doctor_profiles d
where d.verification_status = 'approved' and d.is_active and d.fee_status = 'approved';

grant select on public.public_doctor_directory to anon, authenticated;
