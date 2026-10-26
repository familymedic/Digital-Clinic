-- ROLLBACK for 0091_voice_notes.sql.
-- Puts the attachment type list back to images and PDF only. Voice notes
-- already sent stay in the chat (the old rule is added "not valid", which
-- means it applies to new messages only, so nothing already saved is lost).
alter table public.consultation_messages
  drop constraint if exists consultation_messages_attachment_type;
alter table public.consultation_messages
  add constraint consultation_messages_attachment_type check (
    attachment_content_type is null
    or attachment_content_type = 'application/pdf'
    or attachment_content_type like 'image/%'
  ) not valid;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
    where id = 'consultation-attachments';
  end if;
end $$;
