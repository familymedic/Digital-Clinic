-- Doctor onboarding, step 4: the PKR 5,000/month platform subscription
-- fee (raised as part of the original doctor-onboarding request,
-- 2026-09-14, deliberately deferred until now — the physician chose to
-- run a real Safepay Subscriptions sandbox test first, since Safepay's
-- own docs never confirm recurring charges actually fire automatically;
-- that test is still in progress).
--
-- Scoped with the physician (2026-09-14) as: build the webhook handling,
-- schema, subscribe flow, and admin visibility now; do NOT make an
-- unpaid subscription block a doctor's dashboard access yet — that
-- enforcement step is explicitly held back until a real renewal charge
-- has been confirmed firing on its own (see docs/safepay-subscriptions-
-- sandbox-test-steps-2026-09-14.md). Nothing in this migration touches
-- any existing access-control check (verification_status/is_active/
-- fee_status stay exactly as 0027/0028 left them).
--
-- Key integration fact, confirmed by reading Safepay's own webhook
-- documentation and SDK source directly (not guessed): a
-- `subscription.*` webhook payload carries `customer_email` and the
-- subscription's own `id`, but no merchant-supplied identifier — so
-- matching an incoming webhook to one of OUR doctors has to happen by
-- email. `doctor_profiles.email` is added here (backfilled from
-- auth.users once) precisely so that match can be a plain column
-- comparison, without ever needing to query the `auth` schema directly
-- from application code.

-- 1. doctor_profiles gains the fields needed to know a doctor's own
--    subscription state, and the email to match a webhook against.
alter table public.doctor_profiles
  add column if not exists email text,
  add column if not exists subscription_status text not null default 'unpaid',
  add column if not exists safepay_subscription_id text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_last_event_at timestamptz;

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_subscription_status_check;

alter table public.doctor_profiles
  add constraint doctor_profiles_subscription_status_check
  check (subscription_status in ('unpaid', 'active', 'past_due', 'canceled'));

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_safepay_subscription_id_key;

alter table public.doctor_profiles
  add constraint doctor_profiles_safepay_subscription_id_key unique (safepay_subscription_id);

-- One-time backfill: every doctor row that exists right now (both the
-- physician's own grandfathered account and any self-registered ones)
-- gets its email filled in from auth.users, so matching works
-- immediately rather than only for doctors who register from now on.
-- src/app/api/doctors/register and src/app/api/admin/doctors both now
-- set this column directly at insert time going forward.
update public.doctor_profiles dp
set email = u.email
from auth.users u
where u.id = dp.id and dp.email is null;

-- No RLS/grant change needed: doctor_profiles has no doctor-facing
-- UPDATE policy at all (checked when 0027 was written, still true) —
-- only the admin-gated policy from 0026 can write these new columns
-- through the app, and that policy has no column-level narrowing, so
-- admin's existing "manual override" ability extends to these
-- automatically, the same way it already does for fee_status/is_active.
-- The webhook route below writes them with the service-role key, which
-- bypasses RLS entirely, same as every other webhook-driven write in
-- this project (0024's payments, 0012's safety-event notification).

-- 2. doctor_subscription_events: an append-only log of every
--    subscription-related webhook received, matched to a doctor or not.
--    Same "always store the raw payload, never lose an event even if we
--    can't act on it yet" principle as payments.raw_webhook_payload
--    (0024) — this is what makes the admin-side manual fallback
--    possible when email-matching fails (a doctor subscribes with a
--    different email than their doctor account, a typo, etc.).
create table if not exists public.doctor_subscription_events (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references auth.users (id),
  event_type text not null,
  safepay_subscription_id text,
  customer_email text,
  matched boolean not null default false,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.doctor_subscription_events enable row level security;

drop policy if exists "Admins can view subscription events" on public.doctor_subscription_events;
create policy "Admins can view subscription events"
  on public.doctor_subscription_events for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- No INSERT/UPDATE/DELETE policy for anyone — service-role only (the
-- webhook route), same pattern as `payments` (0024): with RLS enabled
-- and zero permissive policies for a command, Postgres denies that
-- command outright regardless of any table-level grant.
