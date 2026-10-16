-- Undo 0078: removes the message-alert trigger, the reply check and the reply column.
-- (Replies already sent lose their quote link; the messages themselves stay.)
drop trigger if exists on_consultation_message_alert on public.consultation_messages;
drop function if exists public.notify_new_consultation_message();
drop trigger if exists consultation_messages_check_reply on public.consultation_messages;
drop function if exists public.consultation_messages_check_reply();
alter table public.consultation_messages drop column if exists reply_to_id;
