-- Fix for a real, live bug found while building terms-acceptance
-- tracking (0057): confirmed directly against the live database
-- (physician ran `select table_name from information_schema.tables`)
-- that `patient_profiles` does not exist at all — meaning
-- 0050_guest_patient_accounts.sql's `alter table public.patient_profiles
-- add column ...` can never have run successfully, the guest cleanup
-- job was never actually scheduled, and every real "Continue as a
-- guest" attempt on the live site has been hitting a database error on
-- the `.from("patient_profiles").update(...)` call in
-- api/guest/start/route.ts — which, per that route's own code, then
-- deletes the just-created account and shows the patient "Couldn't
-- start your consultation." If Quick Consult has been used for a real
-- booking since it shipped 2026-09-30, this migration is likely why it
-- hasn't worked.
--
-- The fix moves guest tracking onto `family_members` instead — a table
-- that definitely exists — specifically onto the 'self' row every
-- guest account already gets from the existing
-- handle_new_account_self_member() trigger (0003). This also fixes a
-- second, smaller bug this exposed: api/guest/start/route.ts was
-- separately INSERTing its own 'self' family_members row after account
-- creation, not realizing the signup trigger already creates one —
-- every guest account was silently getting TWO 'self' family members.
-- The accompanying app-code change removes that redundant insert and
-- updates the trigger-created row instead.
--
-- 0050 itself is left in place rather than edited, for the same reason
-- 0002_consultations.sql was kept after being superseded by 0003: it's
-- a record of what was originally intended, even though it never
-- actually took effect. Treat 0050 as superseded by this migration.

-- 1. Guest-tracking columns, now on family_members. Same semantics as
--    0050 originally intended, just scoped to the account's 'self' row
--    rather than a separate per-account table — a guest account always
--    has exactly one 'self' member (the account holder), so this is
--    functionally identical to an account-level flag.
alter table public.family_members
  add column if not exists is_guest boolean not null default false,
  add column if not exists guest_created_at timestamptz,
  add column if not exists guest_converted_at timestamptz,
  add column if not exists anonymized_at timestamptz;

comment on column public.family_members.is_guest is
  'true on the ''self'' row of an account auto-created by the guest "quick consult" flow (no password ever chosen by the patient). Set once at creation, never changed back. Meaningless on a non-self family member (a guest''s spouse/child row added later) — the cleanup job below only ever looks at the self row.';
comment on column public.family_members.guest_created_at is
  'When a guest account was created -- the clock the 15-day cleanup counts from. Null for a normal registered patient''s self row, and for any non-self family member.';
comment on column public.family_members.guest_converted_at is
  'Set the moment a guest sets their own real password (see /reset-password) and so chooses to keep their account. Once set, this account is permanently excluded from guest cleanup.';
comment on column public.family_members.anonymized_at is
  'Set when the 15-day cleanup anonymized (rather than deleted) this account, because it had a real paid consultation worth keeping a record of. Also an idempotency guard so it is only ever processed once.';

-- 2. The cleanup function itself, rewritten against family_members
--    instead of patient_profiles. Same logic as 0050 intended:
--    unconverted guest past 15 days with no successful payment ->
--    delete outright; with a successful payment -> anonymize (scrub
--    name/phone/email, keep the consultation/payment record).
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
    select fm.id, fm.account_id
    from public.family_members fm
    where fm.relationship = 'self'
      and fm.is_guest = true
      and fm.guest_converted_at is null
      and fm.anonymized_at is null
      and fm.guest_created_at is not null
      and fm.guest_created_at < now() - interval '15 days'
  loop
    -- Each guest is handled in its own sub-block, same safety net 0050
    -- originally built and tested: one unexpected failure skips only
    -- that row, never the whole day's run.
    begin
      select exists (
        select 1 from public.payments
        where account_id = v_row.account_id and status = 'succeeded'
      ) into v_has_paid_consultation;

      if v_has_paid_consultation then
        -- Keep the consultation/payment record; scrub who it belongs to.
        v_anon_email := 'removed-' || v_row.account_id::text || '@anonymized.familymedic.invalid';

        update public.family_members
          set full_name = 'Removed guest', date_of_birth = null
          where account_id = v_row.account_id;

        update public.family_members
          set anonymized_at = now()
          where id = v_row.id;

        update auth.users
          set email = v_anon_email,
              phone = null,
              raw_user_meta_data = jsonb_build_object('full_name', 'Removed guest')
          where id = v_row.account_id;

      else
        -- No real record worth keeping -- remove the account outright.
        -- payments.account_id has no cascade (0024), so it must be
        -- removed explicitly before auth.users or the delete below
        -- fails on a foreign-key violation (same fix 0050 already
        -- found necessary once). family_members itself cascades from
        -- auth.users (0003), so no separate delete is needed for it.
        delete from public.payments where account_id = v_row.account_id;
        delete from auth.users where id = v_row.account_id;
      end if;
    exception when others then
      raise warning 'cleanup_guest_patient_accounts: skipped account % due to %', v_row.account_id, sqlerrm;
    end;
  end loop;
end;
$$;

-- 3. (Re-)schedule the daily job. cron.schedule() upserts by job name,
--    so this is safe whether or not the job already exists — and since
--    0050 never actually got this far (the ALTER TABLE before it would
--    have errored out first), this is very likely the first time this
--    job is ever actually created.
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-guest-patient-accounts',
  '30 3 * * *',
  $$select public.cleanup_guest_patient_accounts();$$
);

-- Same known, deliberate limitation 0050 already flagged: this does
-- not rewrite Supabase Auth's internal auth.identities table, which can
-- still carry a copy of the original email after anonymization. Not
-- queried or shown anywhere in this app, so not a functional issue.
