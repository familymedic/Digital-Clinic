-- Follow-up to the Safepay KYC website-compliance work (Section 57):
-- while building the real Terms/Privacy/Refund pages, two real gaps in
-- the app itself were found and confirmed by reading the live code (not
-- guessed): (1) admin gets no notification at all when a patient or
-- doctor cancels a paid consultation — the only way to find out is to
-- manually check /admin/refunds; (2) the "I agree to Terms" checkbox at
-- registration (and the lack of any such step at all for guest
-- checkout) records nothing — no timestamp, no version — unlike the
-- doctor engagement agreement, which has had proper version-tracked
-- acceptance since 2026-09-26 (doctor_agreement_acceptances, 0047).
-- Both matter for the same reason: if a patient or Safepay ever
-- disputes a no-refund decision, there should be real, timestamped
-- proof of what the patient agreed to and what actually happened to
-- the booking.
--
-- Originally this was going to extend handle_new_patient_user() (the
-- 0001 signup trigger) with two new columns on patient_profiles — but
-- confirmed directly against the live database (physician ran the
-- queries) that neither exists: patient_profiles was dropped in 0003
-- in favor of family_members, and the live auth.users trigger really
-- is still just the original 0003 handle_new_account_self_member(),
-- not handle_new_patient_user() at all. (That in turn exposed a real,
-- separate bug in guest checkout — see 0058 for the fix.)
--
-- Given that, this uses the SAME pattern already proven live for
-- doctors — a dedicated, append-only acceptance table — rather than
-- columns on an account table, and records it via a brand new trigger
-- that reads signup metadata, instead of touching the existing
-- handle_new_account_self_member() function at all. This is
-- deliberately the safer shape: two independent AFTER INSERT triggers
-- on auth.users is completely normal to Postgres (both fire; order
-- between them doesn't matter here since each only touches its own
-- table), and it means this migration cannot possibly break the
-- family_members self-row creation that already works today.

-- 1. patient_agreement_acceptances — mirrors doctor_agreement_acceptances'
--    shape (id, <owner>_id, <agreement>_version, accepted_at). Append-
--    only by design (no UPDATE/DELETE policy for anyone): once
--    recorded, an acceptance is a historical fact, not something to be
--    edited later, the same principle as consultation_messages (0022)
--    and payments (0024).
create table if not exists public.patient_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  patient_account_id uuid not null references auth.users (id) on delete cascade,
  agreement_version text not null,
  accepted_at timestamptz not null default now()
);

create index if not exists patient_agreement_acceptances_account_id_idx
  on public.patient_agreement_acceptances (patient_account_id);

alter table public.patient_agreement_acceptances enable row level security;

drop policy if exists "Patients can view their own terms acceptance" on public.patient_agreement_acceptances;
create policy "Patients can view their own terms acceptance"
  on public.patient_agreement_acceptances for select
  using (patient_account_id = auth.uid());

-- No INSERT policy for `authenticated` at all, deliberately — the only
-- way a row is ever created is the trigger below (security definer,
-- fires from the server-side signup itself) or a service-role client,
-- the same "never let the client assert its own compliance" posture as
-- every other audit-style table in this app.

-- 2. Record it automatically from signup metadata, for BOTH a normal
--    /register signup (supabase.auth.signUp's options.data) and a
--    guest quick-consult signup (serviceClient.auth.admin.createUser's
--    user_metadata) — both already populate raw_user_meta_data the
--    same way, so one trigger covers both without either piece of app
--    code needing to know about this table directly. A doctor or admin
--    signup never sets terms_version in its metadata, so this quietly
--    does nothing for those — not an oversight, just scoped to where
--    app code actually sets the key.
--
--    Fails open (warns, never blocks): this is a brand new, unproven
--    trigger firing on EVERY auth signup on the platform, including
--    doctor/admin accounts that have nothing to do with this feature.
--    A bug here blocking all signups platform-wide would be far worse
--    than an occasional missing acceptance row — the same tradeoff
--    every other notification trigger in this project already makes,
--    just applied to a trigger that writes a row instead of sending a
--    message.
create or replace function public.record_patient_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text;
begin
  v_version := new.raw_user_meta_data ->> 'terms_version';
  if v_version is not null and trim(v_version) <> '' then
    insert into public.patient_agreement_acceptances (patient_account_id, agreement_version)
    values (new.id, v_version);
  end if;
  return new;
exception when others then
  raise warning 'record_patient_terms_acceptance: failed to record acceptance for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_record_terms_acceptance on auth.users;
create trigger on_auth_user_created_record_terms_acceptance
  after insert on auth.users
  for each row execute function public.record_patient_terms_acceptance();

-- 3. Admin push alert on cancellation. Fires only on the specific
--    transition INTO 'cancelled' (never on an unrelated update to an
--    already-cancelled row, and never on the initial insert — a
--    consultation is never created already-cancelled). Reuses the
--    exact same push_internal_secret + site_base_url Vault secrets and
--    the same /api/push/send endpoint every other push notification in
--    this project already calls (0055/0056) — no new secret, no new
--    environment variable, no new app code needed for this half.
--
--    Same fail-open guarantee as every notification trigger in this
--    project (0012/0013/0039/0055/0056): a notification failure here
--    (Vault secret missing, pg_net down, the app temporarily
--    unreachable) is caught and swallowed so it can never roll back or
--    block the cancellation itself, which is the real, authoritative
--    action.
create or replace function public.notify_admin_of_consultation_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push_secret text;
  v_site_url text;
  v_patient_name text;
  v_canceller_label text;
  v_body text;
begin
  if not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    return new;
  end if;

  begin
    select decrypted_secret into v_push_secret
    from vault.decrypted_secrets
    where name = 'push_internal_secret'
    limit 1;

    if v_push_secret is null or v_push_secret = '' then
      -- Push isn't configured yet — skip silently, same as every other
      -- notification trigger when its key is missing.
      return new;
    end if;

    select decrypted_secret into v_site_url
    from vault.decrypted_secrets
    where name = 'site_base_url'
    limit 1;

    if v_site_url is null or v_site_url = '' then
      -- Can't reach our own /api/push/send without knowing our own
      -- public URL. Same "skip silently, nothing to log" posture.
      return new;
    end if;

    select fm.full_name into v_patient_name
    from public.family_members fm
    where fm.id = new.patient_id;

    v_canceller_label := case
      when new.cancelled_by is not null and new.cancelled_by = new.doctor_id then 'the doctor'
      else 'the patient'
    end;

    v_body := coalesce(v_patient_name, 'A patient') || E'’s consultation was cancelled by '
      || v_canceller_label
      || case
           when new.cancellation_reason is not null and trim(new.cancellation_reason) <> ''
             then ': "' || new.cancellation_reason || '"'
           else '.'
         end;

    perform net.http_post(
      url := rtrim(v_site_url, '/') || '/api/push/send',
      headers := jsonb_build_object(
        'x-internal-secret', v_push_secret,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'broadcastRole', 'admin',
        'title', 'Consultation cancelled',
        'body', v_body,
        'url', '/admin/refunds'
      )
    );
  exception when others then
    raise warning 'notify_admin_of_consultation_cancellation: notification failed, cancellation still recorded: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_consultation_cancelled_notify_admin on public.consultations;
create trigger on_consultation_cancelled_notify_admin
  after update on public.consultations
  for each row execute function public.notify_admin_of_consultation_cancellation();
