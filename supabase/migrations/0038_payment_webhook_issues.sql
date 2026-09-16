-- Fix #2 from the 2026-09-16 technical audit follow-up: if a real
-- Safepay webhook payload doesn't match the field names
-- api/payments/webhook/route.ts guesses at (documented there as
-- "plausible-but-unconfirmed" until the real sandbox test runs), the
-- payment silently stays 'pending' forever with nothing but a
-- console.error — no admin-facing trace that a specific payment needs
-- a manual look. Both audits (2026-09-13 and 2026-09-16) named this
-- the single most important open loop, so it's worth being able to see
-- when it happens the moment the physician's own Safepay sandbox test
-- actually runs, rather than discovering it only by a patient
-- complaining "I paid and nothing happened."
--
-- This is a read-only diagnostic log, not a new payment-processing
-- path — the webhook route (updated alongside this migration) inserts
-- a row here in the two cases it already can't fully resolve on its
-- own (an unrecognized payload with no order/tracker match, or a
-- recognized payment whose outcome couldn't be determined), in
-- addition to what it already does today. Nothing about how a payment
-- is actually matched or marked succeeded/failed changes.

create table public.payment_webhook_issues (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  reason text not null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

create index payment_webhook_issues_unresolved_idx
  on public.payment_webhook_issues (created_at)
  where not resolved;

alter table public.payment_webhook_issues enable row level security;

-- No insert policy for `authenticated`/`anon` at all — this table is
-- only ever written by the webhook route's own service-role client
-- (same "only the service role can write payments" pattern as 0024),
-- never by a browser.
create policy "Admins can view webhook issues"
  on public.payment_webhook_issues for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

create policy "Admins can resolve webhook issues"
  on public.payment_webhook_issues for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));
