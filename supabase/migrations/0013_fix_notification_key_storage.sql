-- Phase 6 fix: 0012's setup instructions told the physician to run
-- `alter database postgres set app.settings.resend_api_key = '...'`
-- to store the Resend API key. He hit this error running it in the
-- Supabase SQL Editor:
--   ERROR: 42501: permission denied to set parameter "app.settings.resend_api_key"
-- This is a real, documented Supabase limitation: the `postgres` role
-- used in the SQL Editor is not a full cluster superuser there (unlike
-- on a generic self-hosted Postgres, which is why this worked in
-- local testing), so `ALTER DATABASE ... SET` for a custom setting is
-- blocked.
--
-- Fix: use Supabase Vault instead (`vault.secrets` /
-- `vault.decrypted_secrets`) -- Supabase's own built-in, documented
-- mechanism for exactly this: a secret a database function/trigger
-- needs to read, settable from the SQL Editor without superuser. This
-- migration only changes HOW the trigger function looks up the API
-- key (and, now, the notify-to email) -- the trigger itself, when it
-- fires, and the "never block or lose the Safety Event" guarantee
-- from 0012 are all unchanged, and re-verified below.
--
-- After running this migration, set the secret from the Supabase SQL
-- Editor (replace the placeholder with your real key):
--   select vault.create_secret('paste-your-resend-api-key-here', 'resend_api_key', 'Resend API key for doctor safety-event notifications');
-- Optional, only if you want alerts sent somewhere other than
-- impactbridgeacademy@gmail.com:
--   select vault.create_secret('you@example.com', 'doctor_notify_email', 'Where safety-event alerts should be sent');
-- To change a secret already set, use vault.update_secret(id, new_secret)
-- rather than create_secret again (which would create a second row).

create or replace function public.notify_doctor_of_safety_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  notify_to text;
  v_complaint text;
  v_patient_name text;
begin
  -- Same guarantee as 0012: everything below is best-effort
  -- notification, never a condition for the Safety Event itself. Any
  -- failure here (Vault not configured yet, pg_net down, a bad key)
  -- is caught and swallowed so it can never roll back or block the
  -- triggering insert.
  begin
    select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key'
    limit 1;

    if api_key is null or api_key = '' then
      -- No key configured yet — skip silently, nothing to log.
      return new;
    end if;

    select decrypted_secret into notify_to
    from vault.decrypted_secrets
    where name = 'doctor_notify_email'
    limit 1;

    -- Configurable per Section 22's multi-doctor readiness — falls
    -- back to the physician's own account email if no override is set.
    notify_to := coalesce(notify_to, 'impactbridgeacademy@gmail.com');

    select c.complaint, fm.full_name
      into v_complaint, v_patient_name
    from public.consultations c
    join public.family_members fm on fm.id = c.patient_id
    where c.id = new.consultation_id;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'AI Clinic Assistant <onboarding@resend.dev>',
        'to', jsonb_build_array(notify_to),
        'subject', 'Priority review needed: ' || coalesce(v_complaint, 'a consultation')
          || ' — ' || coalesce(v_patient_name, 'a patient'),
        'text',
          'A safety flag was triggered and this consultation needs your priority review.' || chr(10) || chr(10) ||
          'Patient: ' || coalesce(v_patient_name, 'unknown') || chr(10) ||
          'Complaint: ' || coalesce(v_complaint, 'unknown') || chr(10) ||
          'Rule: ' || new.rule_description || chr(10) ||
          'System action taken: ' || new.system_action || chr(10) ||
          'Consultation ID: ' || new.consultation_id || chr(10) ||
          'Triggered at: ' || new.created_at
      )
    );
  exception when others then
    raise warning 'notify_doctor_of_safety_event: notification failed, safety event still recorded: %', sqlerrm;
  end;

  return new;
end;
$$;

-- The trigger itself already points at this function name (created in
-- 0012) and needs no change — CREATE OR REPLACE FUNCTION above updates
-- its body in place.
