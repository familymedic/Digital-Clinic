-- Phase 10, step 1: real payment collection for the PKR 500 pay-as-you-go
-- consultation fee, via Safepay (a Pakistani payment gateway — chosen
-- after comparing it against direct JazzCash/Easypaisa integration and
-- several other Pakistani aggregators; see the physician's research doc).
--
-- Scoped with the physician (2026-09-13) as: (1) a consultation is saved
-- immediately at booking time with a new 'pending_payment' status,
-- invisible to the doctor, and only Safepay's own server-to-server
-- webhook — never anything the patient's browser reports — flips it to
-- a real, doctor-visible booking; (2) a doctor-marked "waived" follow-up
-- (0019) stays exactly what it already was, a bookkeeping note — every
-- booking still goes through this same payment step, and an actual
-- waiver/refund for a specific patient is something the physician does
-- manually from Safepay's own dashboard, not something this app
-- automates yet.

-- 1. New booking default + an explicit, defensive status list. Existing
--    rows are untouched (a DEFAULT only affects future inserts); every
--    row already in the table is 'submitted' or 'completed', both still
--    valid under the new check.
alter table public.consultations
  alter column status set default 'pending_payment';

alter table public.consultations
  add constraint consultations_status_check
  check (status in ('pending_payment', 'submitted', 'completed'));

-- 2. Payments. One row per payment ATTEMPT (not one per consultation —
--    a patient who abandons checkout and tries again gets a second row,
--    which is the simplest correct model rather than trying to reuse or
--    expire a stale attempt). `account_id` (not `patient_id`) because a
--    payment is something the logged-in account pays, same scoping
--    `family_members.account_id` already uses elsewhere.
--
--    RLS deliberately has ONLY a SELECT policy — no INSERT/UPDATE/DELETE
--    policy at all, for anyone, the same "immutable except via a
--    server-side service-role client" pattern already proven for
--    `consultation_messages` (0022, no UPDATE/DELETE policy) and for
--    `video_room_*` (0023, no column grant at all). With row level
--    security enabled and zero permissive policies for a given command,
--    Postgres denies that command outright regardless of table-level
--    grants — so the only way any row here is ever written is through
--    the new API routes below, using the Supabase service-role key.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  account_id uuid not null references auth.users (id),
  amount int not null,
  currency text not null default 'PKR',
  gateway text not null default 'safepay',
  gateway_tracker_token text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  raw_webhook_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments enable row level security;

drop policy if exists "Account holders can view their own payments" on public.payments;
create policy "Account holders can view their own payments"
  on public.payments for select
  using (account_id = auth.uid());

-- No doctor-facing policy at all, deliberately (Section 12 of the
-- physician's requirements: commercial/billing detail stays out of the
-- clinical workspace — the doctor only ever needs to know a
-- consultation reached them at all, which the status transition itself
-- already guarantees).
