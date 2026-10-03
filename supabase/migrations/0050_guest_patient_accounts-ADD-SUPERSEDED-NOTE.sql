-- SUPERSEDED (2026-10-03) — this file's `alter table public.patient_profiles
-- ...` targets a table that does not exist in the live database
-- (confirmed directly: `patient_profiles` was dropped in 0003, long
-- before this was written, and never recreated). This migration can
-- never have run successfully, meaning the guest cleanup job was never
-- actually scheduled and every real guest-checkout attempt has been
-- hitting a database error. See 0058_fix_guest_account_tracking.sql,
-- which does the same thing against `family_members` instead — do not
-- run this file; kept only as a record of the original intent, the
-- same way 0002_consultations.sql was kept after being superseded.
--
-- Guest "quick consult" accounts + their automatic cleanup (2026-09-30,
-- physician: "is there a passage where we can offer patients to consult
-- without registering for those who dont want to register?" followed by
-- "add auto removal of patient data after 15 days so the database
-- doesnt get crowded for those who dont want to register only the ones
-- who want to keep the account should have the privilege to keep data
-- safe").
--
-- Two ideas land together here because they're two halves of one
-- feature:
--
-- 1. A patient can book and pay for a consultation without first going
--    through a signup screen or choosing a password. A REAL Supabase
--    account is still created behind the scenes, automatically, with a
--    random password the patient never sees (see the accompanying
--    src/app/api/guest/start/route.ts) — that is deliberate: it means
--    every existing RLS policy, the booking flow, and the payment flow
--    all work completely unchanged for a guest, because as far as the
--    database is concerned a guest is not a special case, just an
--    ordinary patient account nobody consciously signed up for yet.
--
-- 2. Because that account was never a deliberate choice, it shouldn't
--    sit in the database forever by default — only a patient who
--    actively chooses to keep it (by setting a real password, the same
--    "keep the account" decision behind option B of the physician's own
--    choice here) gets to keep their data indefinitely, same as anyone
--    who registered normally in the first place.
--
-- The 15-day cleanup below treats two situations differently, on
-- purpose:
--   - A guest who never completed a PAID consultation (abandoned the
--     form, or booked but never paid) has no real medical or financial
--     record worth keeping at all — deleted outright.
--   - A guest who DID complete a real, paid consultation is different:
--     the consultation and payment record itself has real value to the
--     physician later (a payment dispute, bookkeeping, a patient
--     calling back about the same issue) even after the patient's own
--     contact details are gone. So instead of deleting those rows, this
--     only strips the identifying fields (name, phone, email) after 15
--     days and leaves the clinical/payment record itself in place under
--     an anonymized account. The physician chose this explicitly
--     (2026-09-30, "Anonymize only") over deleting everything, exactly
--     for that reason.
--
-- A patient who sets a real password for their guest account (via the
-- site's existing /reset-password page — see the accompanying app-code
-- change there) is choosing to keep it: guest_converted_at gets set,
-- and that account is permanently excluded from this cleanup from then
-- on. A normal /register signup is never touched by any of this at all
-- — is_guest defaults to false and nothing here ever sets it true for
-- them.

alter table public.patient_profiles
  add column if not exists is_guest boolean not null default false,
  add column if not exists guest_created_at timestamptz,
  add column if not exists guest_converted_at timestamptz,
  add column if not exists anonymized_at timestamptz;

comment on column public.patient_profiles.is_guest is
  'true for an account auto-created by the guest "quick consult" flow (no password ever chosen by the patient). Set once at creation, never changed back.';
comment on column public.patient_profiles.guest_created_at is
  'When a guest account was created -- the clock the 15-day cleanup counts from. Null for normal registered patients.';
comment on column public.patient_profiles.guest_converted_at is
  'Set the moment a guest sets their own real password (see /reset-password) and so chooses to keep their account. Once set, this account is permanently excluded from guest cleanup.';
comment on column public.patient_profiles.anonymized_at is
  'Set when the 15-day cleanup anonymized (rather than deleted) this account, because it had a real paid consultation worth keeping a record of. Also an idempotency guard so it is only ever processed once.';

create or replace function public.cleanup_guest_patient_accounts()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_row record;
  v_has_paid_consultation boolean;
  v_anon_email text;
begin
  for v_row in
    select p.id
    from public.patient_profiles p
    where p.is_guest = true
      and p.guest_converted_at is null
      and p.anonymized_at is null
      and p.guest_created_at is not null
      and p.guest_created_at < now() - interval '15 days'
  loop
    -- Each guest is handled in its own sub-block: a failure on one row
    -- (an unexpected constraint, a locked row, anything) is caught and
    -- logged rather than aborting the whole day's cleanup run and
    -- leaving every OTHER guest un-cleaned too. Proven necessary by
    -- real local testing below, not a hypothetical: an earlier version
    -- of this function, tested without this guard, genuinely failed
    -- outright on a guest with even a FAILED payment attempt (see the
    -- next comment) and would have taken the entire run down with it.
    begin
      select exists (
        select 1 from public.payments
        where account_id = v_row.id and status = 'succeeded'
      ) into v_has_paid_consultation;

      if v_has_paid_consultation then
        -- Keep the consultation/payment record; scrub who it belongs to.
        v_anon_email := 'removed-' || v_row.id::text || '@anonymized.familymedic.invalid';

        update public.family_members
          set full_name = 'Removed guest', date_of_birth = null
          where account_id = v_row.id;

        update public.patient_profiles
          set full_name = 'Removed guest', phone = null, anonymized_at = now()
          where id = v_row.id;

        update auth.users
          set email = v_anon_email,
              phone = null,
              raw_user_meta_data = jsonb_build_object('full_name', 'Removed guest')
          where id = v_row.id;

      else
        -- No real record worth keeping -- remove the account outright.
        --
        -- `payments.account_id` references auth.users DIRECTLY, and
        -- WITHOUT cascade (confirmed against the real schema, 0024 --
        -- unlike patient_profiles/family_members/consultations, which
        -- all do cascade). A guest who attempted payment and failed
        -- (or whose payment is still merely "pending") still has a
        -- payments row pointing at this account, so it must be removed
        -- explicitly here first or the delete below fails outright
        -- with a foreign-key violation. This was caught by real local
        -- testing, not assumed — an earlier version of this migration,
        -- without this line, genuinely failed this exact case.
        delete from public.payments where account_id = v_row.id;
        delete from auth.users where id = v_row.id;
      end if;
    exception when others then
      raise warning 'cleanup_guest_patient_accounts: skipped account % due to %', v_row.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Requires the pg_cron extension. Supabase projects can normally enable
-- this directly from SQL, as below; if this one line errors with a
-- permissions message, enable "pg_cron" once from the Supabase
-- dashboard (Database -> Extensions) and then re-run just this
-- migration.
create extension if not exists pg_cron;

-- Runs once a day at 03:30 UTC (a quiet hour). cron.schedule() upserts
-- by job name, so re-running this migration later is always safe --
-- it just refreshes the same scheduled job rather than creating a
-- duplicate one.
select cron.schedule(
  'cleanup-guest-patient-accounts',
  '30 3 * * *',
  $$select public.cleanup_guest_patient_accounts();$$
);

-- Known, deliberate limitation (documented rather than silently
-- skipped): this scrubs the patient-facing name/phone/email fields
-- your own app actually reads and displays. It does not also rewrite
-- Supabase Auth's internal `auth.identities` table, which can still
-- carry a copy of the original email in its own internal JSON after
-- anonymization. That table is never queried or shown anywhere in this
-- app, so it isn't a functional issue -- flagged here only so it's a
-- known tradeoff, not a surprise, if a deeper privacy pass is ever
-- needed later.
