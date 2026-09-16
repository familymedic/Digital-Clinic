-- Fix #3 from the 2026-09-16 technical audit follow-up: today the only
-- notification anywhere in this product is one internal email to the
-- physician when a safety flag fires (0012/0013) — a patient finds out
-- everything else (payment succeeded, a prescription is ready) only by
-- logging back into the portal and looking. Marham's own case study
-- with their messaging vendor credits exactly this kind of
-- notification with cutting patient complaints 40-50%.
--
-- This closes the "prescription is ready" half of that gap, using the
-- SAME Resend account and the SAME Vault secret (`resend_api_key`)
-- already required for the existing safety-event email — nothing new
-- to sign up for, nothing new to configure, per the physician's own
-- "without incurring any more cost" instruction. The "payment
-- succeeded/failed" half is handled in application code instead (see
-- api/payments/webhook/route.ts), since that moment already happens
-- inside a server-side Next.js route with the patient's email one
-- query away — a database trigger would just be a second, harder-to-
-- test path to the same place.
--
-- Same fail-open guarantee as 0012/0013, verified the same way: a
-- notification failure (Vault not configured, pg_net down, a bad
-- Resend key) is caught and swallowed so it can NEVER roll back or
-- block the triggering prescription-issue update — the clinical record
-- always wins over the email.

create or replace function public.notify_patient_of_issued_prescription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  v_site_url text;
  v_patient_email text;
  v_patient_name text;
  v_complaint text;
  v_link_line text;
begin
  if not (new.status = 'issued' and old.status is distinct from 'issued') then
    return new;
  end if;

  begin
    select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key'
    limit 1;

    if api_key is null or api_key = '' then
      -- Same as the safety-event notifier: no key configured yet,
      -- skip silently, the issued prescription itself is unaffected.
      return new;
    end if;

    select u.email, fm.full_name, c.complaint
      into v_patient_email, v_patient_name, v_complaint
    from public.consultations c
    join public.family_members fm on fm.id = c.patient_id
    join auth.users u on u.id = fm.account_id
    where c.id = new.consultation_id;

    if v_patient_email is null then
      return new;
    end if;

    -- Optional: `site_base_url` isn't set yet because the site has no
    -- live public URL to point to (no GitHub/Vercel deployment exists
    -- yet — Section 41). Once one exists:
    --   select vault.create_secret('https://your-real-domain.com', 'site_base_url', 'Public site URL used in patient emails');
    -- Until then, the email just says to log in, with no dead link.
    select decrypted_secret into v_site_url
    from vault.decrypted_secrets
    where name = 'site_base_url'
    limit 1;

    v_link_line := case
      when v_site_url is not null and v_site_url <> ''
        then 'View it here: ' || rtrim(v_site_url, '/') || '/consultation/' || new.consultation_id || '/prescription'
      else 'Log in to your account to view it.'
    end;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'Family Medic <onboarding@resend.dev>',
        'to', jsonb_build_array(v_patient_email),
        'subject', 'Your prescription is ready',
        'text',
          'Your doctor has reviewed ' || coalesce(v_patient_name, 'your') ||
          case when v_complaint is not null then '''s consultation about "' || v_complaint || '"' else '''s consultation' end ||
          ' and issued a prescription.' || chr(10) || chr(10) ||
          v_link_line || chr(10) || chr(10) ||
          'If you have any questions about your prescription, please contact the clinic.'
      )
    );
  exception when others then
    raise warning 'notify_patient_of_issued_prescription: notification failed, prescription still issued: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_prescription_issued_notify_patient on public.consultation_assessments;
create trigger on_prescription_issued_notify_patient
  after update on public.consultation_assessments
  for each row execute function public.notify_patient_of_issued_prescription();
