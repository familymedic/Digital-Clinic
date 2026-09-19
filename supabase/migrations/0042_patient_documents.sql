-- Standalone health-document uploads + a real "Health Records" area
-- (2026-09-19, physician: "still cannot see space to upload report of
-- check past summary" — the dashboard's "Health Records" nav item has
-- said "soon" since Phase 8/0022, and 0022 deliberately scoped
-- attachments to an OPEN TEXT consultation's message thread only, not
-- a standalone place a patient can add a report at any time). This
-- migration builds the standalone piece: a document a patient attaches
-- to a FAMILY MEMBER (not a specific consultation), visible to any
-- doctor who has ever had a consultation with that family member —
-- e.g. "here's my mother's blood test from last month," uploaded
-- before booking, not mid-thread.
--
-- Deliberately narrow scope, matching how 0022 stayed narrow: patients
-- upload and view; doctors view only (read access during/after a
-- consultation with that patient) — a doctor uploading ON BEHALF OF a
-- patient is a real future want, not built here, since it wasn't asked
-- for and would need its own access-control thinking (which doctor,
-- for which patient, visible to whom). No update/delete either — same
-- "a clinical record reads as permanent" principle 0022 already
-- established for messages; a wrong upload can be described as
-- outdated in a later one, not erased.
--
-- 1. The documents themselves.
create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  family_member_id uuid not null references public.family_members (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id),
  file_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes int not null,
  description text,
  created_at timestamptz not null default now(),
  constraint patient_documents_content_type_check check (
    content_type = 'application/pdf' or content_type like 'image/%'
  ),
  constraint patient_documents_size_check check (size_bytes <= 10485760),
  constraint patient_documents_description_length_check check (
    description is null or char_length(description) <= 200
  )
);

alter table public.patient_documents enable row level security;

-- No UPDATE/DELETE policy for anyone — see the module comment above.

drop policy if exists "Account holders can view their family's documents" on public.patient_documents;
create policy "Account holders can view their family's documents"
  on public.patient_documents for select
  using (family_member_id in (select id from public.family_members where account_id = auth.uid()));

drop policy if exists "Account holders can upload documents for their family" on public.patient_documents;
create policy "Account holders can upload documents for their family"
  on public.patient_documents for insert
  with check (
    uploaded_by = auth.uid()
    and family_member_id in (select id from public.family_members where account_id = auth.uid())
  );

-- A doctor can see a document once they've had AT LEAST ONE
-- consultation (any status — not just open ones, unlike 0022's
-- message-thread scoping, since the whole point here is a doctor
-- reviewing a patient's history across visits) with that family
-- member. Matches the same "doctors can view their patients'..."
-- pattern already used for history/safety events (0016).
drop policy if exists "Doctors can view documents for their patients" on public.patient_documents;
create policy "Doctors can view documents for their patients"
  on public.patient_documents for select
  using (
    family_member_id in (
      select patient_id from public.consultations where doctor_id = auth.uid()
    )
  );

-- 2. Storage bucket. Private, same size/type limits as
--    consultation-attachments (0022) — enforced by Storage itself at
--    upload time, before any row here is ever written.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-documents',
  'patient-documents',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploaded at "<family_member_id>/<random>-<filename>" — same
-- folder-per-owner convention as consultation-attachments (0022),
-- checked here via storage.foldername(name), Supabase's own
-- documented pattern for this. Same local-harness limitation as 0022
-- (storage schema is Supabase-hosted-only) — verify directly against
-- the real project once deployed.
drop policy if exists "Account holders can upload documents for their family" on storage.objects;
create policy "Account holders can upload documents for their family"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.family_members where account_id = auth.uid()
    )
  );

drop policy if exists "Account holders can view their family's documents" on storage.objects;
create policy "Account holders can view their family's documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.family_members where account_id = auth.uid()
    )
  );

drop policy if exists "Doctors can view documents for their patients" on storage.objects;
create policy "Doctors can view documents for their patients"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1]::uuid in (
      select patient_id from public.consultations where doctor_id = auth.uid()
    )
  );