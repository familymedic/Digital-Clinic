-- Doctor status-change notifications (2026-09-30, physician: "if a doctor
-- registered he was approved but he didnt know so he never checked to
-- move to the next step" — a real, confirmed gap: every admin action on
-- doctor_profiles (approve/reject application, approve fee, approve/
-- reject public profile) is a plain client-side Supabase update with no
-- notification of any kind, so a doctor only ever finds out by manually
-- logging back in to check.
--
-- Same architecture as 0012's safety-event notification, reused
-- deliberately rather than inventing a new pattern: a database trigger
-- fires on doctor_profiles UPDATE and calls the Resend email API
-- directly from Postgres via pg_net, using the SAME
-- app.settings.resend_api_key Postgres setting 0012 already requires —
-- no new key, no new account, no new cost. This also means it fires
-- from the database itself regardless of which admin screen or code
-- path performed the update, so it can never be silently bypassed by a
-- future admin action that forgets to call a notification API.
--
-- Deliberately does NOT touch the existing admin page's client-side
-- update calls at all (src/app/admin/doctors/page.tsx) — this is
-- purely additive at the database layer, so there is zero risk of
-- disturbing the already-working approve/reject/activate flows.
--
-- Fires only on a REAL transition into a terminal state the doctor
-- actually needs to know about (checked via IS DISTINCT FROM against
-- the OLD row), not on every unrelated field update to this same row
-- (fee edits, daily cap changes, activate/deactivate toggles, etc. —
-- all of which also go through plain updates on this table and must
-- NOT trigger a spurious email each time).

create or replace function public.notify_doctor_of_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  subject text;
  body_text text;
begin
  -- Same fail-open guarantee as 0012: nothing in here may ever roll
  -- back or block the status-change update itself. A notification
  -- failure is a delivery problem to fix later, never a reason to lose
  -- or delay the actual admin decision.
  begin
    api_key := current_setting('app.settings.resend_api_key', true);
    if api_key is null or api_key = '' then
      return new;
    end if;
    if new.email is null or new.email = '' then
      -- No address on file to notify (shouldn't happen for a doctor who
      -- completed registration, but never block the update over it).
      return new;
    end if;

    -- Application approved. fee_status also moves to
    -- pending_admin_approval or approved in the same update (see
    -- approveApplication in the admin page) — one email covering
    -- whichever actually happened is clearer than two near-simultaneous
    -- ones for the same click.
    if old.verification_status is distinct from new.verification_status
       and new.verification_status = 'approved' then
      subject := 'Your Family Medic application has been approved';
      if new.fee_status = 'approved' then
        body_text :=
          'Good news — your application to join Family Medic has been approved, and you are now live and bookable by patients.' || chr(10) || chr(10) ||
          'Log in to your doctor dashboard to review your profile and availability: https://thefamilymedic.com/doctor/login';
      else
        body_text :=
          'Good news — your application to join Family Medic has been approved.' || chr(10) || chr(10) ||
          'One step remains before you''re bookable by patients: your consultation fee needs a quick admin review. You''ll get another email the moment that''s done — no action needed from you right now, but you''re welcome to log in and check anytime: https://thefamilymedic.com/doctor/login';
      end if;
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <onboarding@resend.dev>',
          'to', jsonb_build_array(new.email),
          'subject', subject,
          'text', body_text
        )
      );
    end if;

    -- Application rejected.
    if old.verification_status is distinct from new.verification_status
       and new.verification_status = 'rejected' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <onboarding@resend.dev>',
          'to', jsonb_build_array(new.email),
          'subject', 'Update on your Family Medic application',
          'text',
            'Your application to join Family Medic was not approved this time.' || chr(10) || chr(10) ||
            coalesce('Reason given: ' || new.rejection_reason || chr(10) || chr(10), '') ||
            'If you have questions, please reply to this email or reach us through thefamilymedic.com/contact.'
        )
      );
    end if;

    -- Fee approved on its own (the "approveFee" second click, for a
    -- doctor whose application approval didn't already flip fee_status
    -- straight to approved).
    if old.fee_status is distinct from new.fee_status
       and new.fee_status = 'approved'
       and old.verification_status = 'approved' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <onboarding@resend.dev>',
          'to', jsonb_build_array(new.email),
          'subject', 'You''re live on Family Medic',
          'text',
            'Your consultation fee has been approved — you are now live and bookable by patients.' || chr(10) || chr(10) ||
            'Log in to your doctor dashboard: https://thefamilymedic.com/doctor/login'
        )
      );
    end if;

    -- Public profile approved/rejected (bio/photo/years, independent of
    -- the PMDC/fee review above — a long-active doctor can submit one
    -- at any time).
    if old.profile_status is distinct from new.profile_status
       and new.profile_status = 'approved' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <onboarding@resend.dev>',
          'to', jsonb_build_array(new.email),
          'subject', 'Your Family Medic profile is now live',
          'text', 'Your public profile (bio, photo, experience) has been approved and is now visible to patients on your doctor page.'
        )
      );
    end if;

    if old.profile_status is distinct from new.profile_status
       and new.profile_status = 'rejected' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Family Medic <onboarding@resend.dev>',
          'to', jsonb_build_array(new.email),
          'subject', 'Your Family Medic profile needs a small change',
          'text',
            'Your submitted public profile wasn''t approved as-is.' || chr(10) || chr(10) ||
            coalesce('Reason given: ' || new.profile_rejection_reason || chr(10) || chr(10), '') ||
            'Please log in and resubmit: https://thefamilymedic.com/doctor/profile'
        )
      );
    end if;

  exception when others then
    raise warning 'notify_doctor_of_status_change: notification failed, status change still saved: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_doctor_status_changed on public.doctor_profiles;
create trigger on_doctor_status_changed
  after update on public.doctor_profiles
  for each row execute function public.notify_doctor_of_status_change();
