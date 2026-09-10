-- Phase 6: Clinical safety layer, step 1 — notify the doctor by email
-- the moment a Safety Event is created.
--
-- Why this first: Phase 5 already built the patient-facing emergency
-- banner, the deterministic red-flag rule engine, and full
-- consultation_safety_events records (rule, response, action,
-- timestamp) — see 0004. But there is no doctor dashboard yet
-- (Phase 7) to actually surface a flagged consultation to the
-- physician. Without this, a red flag could fire and sit in the
-- database with nobody noticing. This closes that specific gap ahead
-- of the full dashboard, per the physician's choice when scoping
-- Phase 6 (2026-09-10: "Doctor notification on a safety event").
--
-- Architecture: a database trigger fires on every INSERT into
-- consultation_safety_events and calls the Resend email API directly
-- from Postgres, using Supabase's pg_net extension (the standard,
-- documented Supabase pattern for "call an API when a row changes" —
-- no separate Edge Function needed). This fires from the database
-- itself, so it still happens even if the patient's browser closes
-- immediately after the red-flag answer is submitted.
--
-- IMPORTANT — cannot be fully tested in Claude's own environment or a
-- local scratch Postgres (Section 41): pg_net is a Supabase-hosted
-- extension, not available on a generic Postgres install, and sending
-- a real email requires the physician's own Resend account and API
-- key (Claude cannot create third-party accounts). What WAS verified
-- locally: the CREATE FUNCTION/TRIGGER statements are valid, and —
-- critically — that a Safety Event insert still succeeds and is never
-- lost whether the notification step is skipped (no key configured)
-- or fails outright (simulated by a missing pg_net locally, standing
-- in for a real-world Resend/network failure). That second case caught
-- a real bug during testing: without the exception block below, a
-- failed net.http_post call rolled back the triggering Safety Event
-- insert entirely — exactly the kind of clinical-record loss Section
-- 12 says must never happen. Fixed before this migration was finalized.
-- The actual email send itself can only be verified against the real
-- project, by the physician, with a synthetic red-flag booking — see
-- the delivery notes for exact steps.
--
-- SECURITY: the Resend API key is NEVER written into this file or
-- committed to git. It is set separately by the physician, after this
-- migration runs, as a Postgres setting:
--   alter database postgres set app.settings.resend_api_key = 'your key here';
--   select pg_reload_conf();
-- (exact steps in the delivery notes). Until that setting exists, the
-- function below skips sending — silently, and safely: Safety Events
-- keep being recorded either way, only the email notification is
-- skipped until the key is configured.

create extension if not exists pg_net;

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
  -- Everything below is best-effort notification, never a condition
  -- for the Safety Event itself. Anything that goes wrong in here —
  -- pg_net not installed, Resend down, a bad API key, a network
  -- error — is caught and swallowed so it can NEVER roll back or
  -- block the triggering insert. The Safety Event record (Section 12:
  -- "the record is never lost") must never depend on an email
  -- succeeding. Confirmed by test: without this block, a failed
  -- net.http_post call rolled back the Safety Event insert entirely.
  begin
    api_key := current_setting('app.settings.resend_api_key', true);
    if api_key is null or api_key = '' then
      -- No key configured yet — skip silently, nothing to log.
      return new;
    end if;

    -- Configurable per Section 22's multi-doctor readiness — falls
    -- back to the physician's own account email if no override is set.
    notify_to := coalesce(
      current_setting('app.settings.doctor_notify_email', true),
      'impactbridgeacademy@gmail.com'
    );

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
    -- Swallow it. The Safety Event above is already committed as far
    -- as this trigger is concerned; a notification failure is a
    -- delivery problem to fix (check Supabase logs), not a reason to
    -- lose or block the clinical record.
    raise warning 'notify_doctor_of_safety_event: notification failed, safety event still recorded: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_safety_event_created on public.consultation_safety_events;
create trigger on_safety_event_created
  after insert on public.consultation_safety_events
  for each row execute function public.notify_doctor_of_safety_event();
