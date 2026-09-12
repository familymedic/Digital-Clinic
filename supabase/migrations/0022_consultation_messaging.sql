-- Phase 8 add-on: an ongoing message thread for text-mode consultations
-- (Section 8's "two methods of history", extended — this is what
-- happens AFTER the guided history, when the doctor needs to ask a
-- follow-up question to reach a diagnosis, rather than being limited
-- to the fixed guided-history Q&A). Scoped with the physician
-- (2026-09-12) as: text-mode consultations only (audio/video keep
-- their call as the place for questions); attachments live inline on
-- individual messages, not a separate documents area; images and PDFs
-- only, ~10MB cap; the thread locks — no further messages from either
-- side — the moment the doctor issues the prescription, mirroring how
-- the assessment itself already locks on issue (0018).
--
-- 1. The messages themselves. `sender_role` is stored explicitly
--    rather than derived, so rendering (and RLS) don't need an extra
--    join to work out who's speaking.
create table if not exists public.consultation_messages (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  sender_role text not null check (sender_role in ('patient', 'doctor')),
  sender_id uuid not null references auth.users (id),
  body text,
  attachment_path text,
  attachment_filename text,
  attachment_content_type text,
  attachment_size_bytes int,
  created_at timestamptz not null default now(),
  constraint consultation_messages_has_content check (
    (body is not null and length(trim(body)) > 0) or attachment_path is not null
  ),
  -- Belt-and-braces alongside the storage bucket's own file_size_limit/
  -- allowed_mime_types below (the bucket is what actually stops an
  -- oversized or wrong-type upload from landing in storage at all;
  -- this just keeps the recorded metadata sane).
  constraint consultation_messages_attachment_type check (
    attachment_content_type is null
    or attachment_content_type = 'application/pdf'
    or attachment_content_type like 'image/%'
  ),
  constraint consultation_messages_attachment_size check (
    attachment_size_bytes is null or attachment_size_bytes <= 10485760
  )
);

alter table public.consultation_messages enable row level security;

-- No UPDATE or DELETE policy on this table at all, for either side —
-- deliberate. A clinical message thread reads as a record once sent;
-- letting either side edit or remove a message after the fact would
-- undermine exactly the kind of traceability Section 12 asks for
-- elsewhere. Correcting a mistake means sending a new message, not
-- rewriting history.

drop policy if exists "Patients can view messages on their own consultations" on public.consultation_messages;
create policy "Patients can view messages on their own consultations"
  on public.consultation_messages for select
  using (
    consultation_id in (
      select id from public.consultations
      where patient_id in (select id from public.family_members where account_id = auth.uid())
    )
  );

drop policy if exists "Doctors can view messages on their own consultations" on public.consultation_messages;
create policy "Doctors can view messages on their own consultations"
  on public.consultation_messages for select
  using (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

-- INSERT is where the scoping and the lock-on-issue both live:
-- text-mode only, and the consultation must not already be completed.
-- Once 0018's mark_consultation_completed_on_issue trigger flips
-- status to 'completed' the instant a prescription is issued, both of
-- these WITH CHECK clauses stop matching and every further send from
-- either side is rejected outright (not a silent no-op — INSERT with
-- no permissive policy throws, same as every other INSERT-time
-- rejection in this schema).
drop policy if exists "Patients can send messages on their own open text consultations" on public.consultation_messages;
create policy "Patients can send messages on their own open text consultations"
  on public.consultation_messages for insert
  with check (
    sender_role = 'patient'
    and sender_id = auth.uid()
    and consultation_id in (
      select id from public.consultations
      where delivery_mode = 'text'
        and status <> 'completed'
        and patient_id in (select id from public.family_members where account_id = auth.uid())
    )
  );

drop policy if exists "Doctors can send messages on their own open text consultations" on public.consultation_messages;
create policy "Doctors can send messages on their own open text consultations"
  on public.consultation_messages for insert
  with check (
    sender_role = 'doctor'
    and sender_id = auth.uid()
    and consultation_id in (
      select id from public.consultations
      where delivery_mode = 'text'
        and status <> 'completed'
        and doctor_id = auth.uid()
    )
  );

-- 2. Storage bucket for attachments. Private (not public) — every read
--    goes through a signed URL the app requests on demand, which only
--    succeeds if the requester's own storage SELECT policy below
--    permits it. file_size_limit and allowed_mime_types are enforced
--    by Supabase Storage itself at upload time, before any row is ever
--    written here — the real, first line of defense, not just the
--    table check constraints above.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consultation-attachments',
  'consultation-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage objects are expected to be uploaded at the path
-- "<consultation_id>/<random>-<filename>" — the app is responsible for
-- that convention; these policies rely on it via
-- storage.foldername(name), the same pattern Supabase's own docs use
-- for per-owner folders. This can't be exercised by this project's
-- local non-superuser RLS harness (the storage schema/extension is
-- Supabase-hosted-only, same limitation already noted for pg_net in
-- 0012) — verify the upload/view boundary directly against the real
-- project once this is deployed.
drop policy if exists "Patients can upload attachments to their own open text consultations" on storage.objects;
create policy "Patients can upload attachments to their own open text consultations"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'consultation-attachments'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.consultations
      where delivery_mode = 'text'
        and status <> 'completed'
        and patient_id in (select id from public.family_members where account_id = auth.uid())
    )
  );

drop policy if exists "Doctors can upload attachments to their own open text consultations" on storage.objects;
create policy "Doctors can upload attachments to their own open text consultations"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'consultation-attachments'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.consultations
      where delivery_mode = 'text' and status <> 'completed' and doctor_id = auth.uid()
    )
  );

drop policy if exists "Patients can view attachments on their own consultations" on storage.objects;
create policy "Patients can view attachments on their own consultations"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'consultation-attachments'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.consultations
      where patient_id in (select id from public.family_members where account_id = auth.uid())
    )
  );

drop policy if exists "Doctors can view attachments on their own consultations" on storage.objects;
create policy "Doctors can view attachments on their own consultations"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'consultation-attachments'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.consultations where doctor_id = auth.uid()
    )
  );
