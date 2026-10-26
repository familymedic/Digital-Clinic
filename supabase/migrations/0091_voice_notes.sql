-- Family packages, part 4 of 4: voice notes in text consultations (2026-10-26).
--
-- A voice note is a chat attachment (an audio file) that the patient or the
-- doctor records in the browser and sends in the same text consultation,
-- exactly like a photo or a PDF today. It rides on everything that already
-- protects attachments: the private storage bucket, the signed 60-second
-- links, the "open text consultation" upload rules, and the lock when the
-- prescription is issued.
--
-- This only widens two lists: the message table's allowed attachment types
-- and the storage bucket's allowed file types. The 10 MB limit is unchanged
-- (a two-minute note is about 1 MB). The screen only offers the recorder in
-- consultations that were started from a family pack.
--
-- ROLLBACK: ROLLBACK-0091.sql

alter table public.consultation_messages
  drop constraint if exists consultation_messages_attachment_type;
alter table public.consultation_messages
  add constraint consultation_messages_attachment_type check (
    attachment_content_type is null
    or attachment_content_type = 'application/pdf'
    or attachment_content_type like 'image/%'
    or attachment_content_type like 'audio/%'
  );

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf',
      'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'
    ]
    where id = 'consultation-attachments';
  end if;
end $$;
