-- Chat replies + "you have a new message" alerts (2026-10-16).
--
-- Part 1: reply-to-a-message (WhatsApp-style swipe to reply)
--   One new, nullable column on consultation_messages. Every existing
--   message simply has no reply target. A small trigger makes sure a reply
--   can only point at a message in the SAME conversation (so one
--   consultation can never quote another one's text).
--
-- Part 2: alerts when someone sends a chat message
--   Until now nobody was told: a patient could text the doctor (or the
--   doctor reply) and the other side only found out by opening the page.
--   After this migration, each new message sends:
--     - a push notification to the other person (if they turned the bell on)
--     - an email instead, if they have no push set up
--   Alerts never include the message text (it is medical and would show on
--   a lock screen), only who it is from and a link. If several messages are
--   sent in a row by the same person within 3 minutes, only the first one
--   alerts, so nobody is spammed.
--   Quick-booking guests have a placeholder address, so they are never
--   emailed (push only).
--
-- Fails open like every other notification here: if push/email is not
-- configured, or anything goes wrong, the message itself is still saved.
-- Safe to run twice. Undo: ROLLBACK-0078.sql.

-- ------------------------------------------------------------ part 1: replies

alter table public.consultation_messages
  add column if not exists reply_to_id uuid
  references public.consultation_messages (id) on delete set null;

create or replace function public.consultation_messages_check_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_id is not null
     and not exists (
       select 1 from public.consultation_messages m
       where m.id = new.reply_to_id
         and m.consultation_id = new.consultation_id
     ) then
    raise exception 'You can only reply to a message in the same conversation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists consultation_messages_check_reply on public.consultation_messages;
create trigger consultation_messages_check_reply
  before insert on public.consultation_messages
  for each row execute function public.consultation_messages_check_reply();

-- ------------------------------------------------------------ part 2: alerts

create or replace function public.notify_new_consultation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push_secret text;
  v_site text;
  v_resend text;
  v_rec record;
  v_prev_role text;
  v_prev_at timestamptz;
  v_patient_name text;
  v_patient_account uuid;
  v_doctor_name text;
  v_doctor_email text;
  v_recipient uuid;
  v_email text;
  v_is_guest boolean := false;
  v_title text;
  v_body text;
  v_url text;
  v_has_push boolean;
begin
  begin
    -- Several messages in a row from the same person: only the first alerts.
    select m.sender_role, m.created_at
      into v_prev_role, v_prev_at
    from public.consultation_messages m
    where m.consultation_id = new.consultation_id
      and m.id <> new.id
    order by m.created_at desc, m.id desc
    limit 1;

    if v_prev_role is not distinct from new.sender_role
       and v_prev_at is not null
       and v_prev_at > new.created_at - interval '3 minutes' then
      return new;
    end if;

    select c.doctor_id, c.patient_id into v_rec
    from public.consultations c
    where c.id = new.consultation_id;
    if v_rec.doctor_id is null or v_rec.patient_id is null then
      return new;
    end if;

    select fm.full_name, fm.account_id
      into v_patient_name, v_patient_account
    from public.family_members fm
    where fm.id = v_rec.patient_id;

    select dp.full_name, dp.email
      into v_doctor_name, v_doctor_email
    from public.doctor_profiles dp
    where dp.id = v_rec.doctor_id;

    select decrypted_secret into v_push_secret
      from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    select decrypted_secret into v_site
      from vault.decrypted_secrets where name = 'site_base_url' limit 1;
    select decrypted_secret into v_resend
      from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    v_site := rtrim(coalesce(nullif(v_site, ''), 'https://thefamilymedic.com'), '/');

    if new.sender_role = 'patient' then
      v_recipient := v_rec.doctor_id;
      v_email := v_doctor_email;
      v_title := 'New patient message';
      v_body := coalesce(nullif(trim(v_patient_name), ''), 'A patient')
                || ' sent you a message. Open the consultation to reply.';
      v_url := '/doctor/consultations/' || new.consultation_id::text;
    else
      v_recipient := v_patient_account;
      select u.email, coalesce(u.raw_user_meta_data ->> 'is_guest', '') = 'true'
        into v_email, v_is_guest
      from auth.users u
      where u.id = v_recipient;
      -- Quick-booking guests only have a made-up address: never email it.
      if v_is_guest or coalesce(v_email, '') like 'guest.%' then
        v_email := null;
      end if;
      v_title := coalesce(nullif(trim(v_doctor_name), ''), 'Your doctor') || ' replied';
      v_body := 'Open your consultation to read the message.';
      v_url := '/consultation/' || new.consultation_id::text || '/messages';
    end if;

    if v_recipient is null then
      return new;
    end if;

    select exists (
      select 1 from public.push_subscriptions ps where ps.account_id = v_recipient
    ) into v_has_push;

    if coalesce(v_push_secret, '') <> '' then
      perform net.http_post(
        url := v_site || '/api/push/send',
        headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'accountId', v_recipient,
          'title', v_title,
          'body', v_body,
          'url', v_url
        )
      );
    end if;

    -- Email only as the fallback for people with no push set up.
    if not v_has_push and coalesce(v_resend, '') <> '' and coalesce(v_email, '') <> '' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_resend, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <contact@thefamilymedic.com>',
          'to', jsonb_build_array(v_email),
          'subject', v_title,
          'text',
            v_body || chr(10) || chr(10) ||
            'Open it here: ' || v_site || v_url || chr(10) || chr(10) ||
            'For privacy, the message itself is not included in this email.'
        )
      );
    end if;
  exception when others then
    raise warning 'notify_new_consultation_message: alert failed, message still saved: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_consultation_message_alert on public.consultation_messages;
create trigger on_consultation_message_alert
  after insert on public.consultation_messages
  for each row execute function public.notify_new_consultation_message();

-- Checks (optional):
--   select column_name from information_schema.columns
--    where table_name = 'consultation_messages' and column_name = 'reply_to_id';
--   select tgname from pg_trigger where tgrelid = 'public.consultation_messages'::regclass and not tgisinternal;
