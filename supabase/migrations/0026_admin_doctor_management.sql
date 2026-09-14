-- Admin system, step 2: doctor management, payouts, refund tracking, and
-- patient feedback — scoped with the physician (2026-09-14) as:
--
-- 1. Consultation fee stays PKR 500 total (already built, 0024) — split
--    as PKR 350 to the consulting doctor and PKR 150 platform fee,
--    settled monthly by the physician himself outside the app (a real
--    bank transfer) with this schema only ever RECORDING that split and
--    tracking what's owed/paid, never moving real money itself (Section
--    41 — Claude/the app cannot disburse funds).
-- 2. A doctor is owed their PKR 350 only once a consultation reaches
--    'completed' — not merely paid-for-and-booked. A refunded
--    consultation pays the doctor nothing at all, regardless of whether
--    it was completed (the payout query below excludes any consultation
--    whose payment shows a refund). A doctor-waived follow-up (0019)
--    still earns the doctor their full PKR 350 — the platform absorbs
--    the whole fee as its own cost for that visit, so waiving never
--    costs the doctor anything.
-- 3. Refunds are a manual admin decision (amount decided case-by-case,
--    processed for real in Safepay's own dashboard, same as today) —
--    this migration only adds a place to RECORD that a refund happened
--    and for how much, which is what then excludes that consultation
--    from the doctor's payout.
-- 4. Patient reviews/complaints are admin-only for now — no doctor- or
--    public-facing policy on the new table at all.

-- 1. doctor_profiles gains an active/inactive flag so admin can suspend
--    a doctor without deleting their account or losing their history.
--    Added, not replacing — every existing doctor row defaults to
--    active, so nothing currently working changes.
alter table public.doctor_profiles
  add column if not exists is_active boolean not null default true;

-- Admins can see and manage every doctor profile (not just their own —
-- the existing 0015 policy only lets a doctor see their OWN row). Same
-- "EXISTS against admin_profiles" pattern as 0025, so a second admin
-- needs no new migration.
drop policy if exists "Admins can view all doctor profiles" on public.doctor_profiles;
create policy "Admins can view all doctor profiles"
  on public.doctor_profiles for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update doctor profiles" on public.doctor_profiles;
create policy "Admins can update doctor profiles"
  on public.doctor_profiles for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Only an admin can insert a new doctor row at all (previously nobody
-- could via the app — only a migration/manual insert). This is what the
-- new admin "add a doctor" screen actually calls, after the account
-- itself is created via the service-role invite API route (a new doctor
-- needs a real auth.users row first, same as today's manual process —
-- see src/app/api/admin/doctors/route.ts).
drop policy if exists "Admins can add doctor profiles" on public.doctor_profiles;
create policy "Admins can add doctor profiles"
  on public.doctor_profiles for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- 1b. Admin needs to see every consultation (unscoped, unlike a doctor's
--     own-assigned-only policy) to count completed/refunded work per
--     doctor for payouts, and to review the platform's activity at all.
--     Read-only — admin never edits a consultation directly here.
drop policy if exists "Admins can view all consultations" on public.consultations;
create policy "Admins can view all consultations"
  on public.consultations for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- 2. payments gains refund tracking. NULL refunded_amount = not
--    refunded. Only an admin (never a patient, never the general
--    "authenticated" write path) can set these — a refund is something
--    admin RECORDS after actually processing it in Safepay's dashboard,
--    never something the app initiates on its own.
alter table public.payments
  add column if not exists refunded_amount int,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_note text;

drop policy if exists "Admins can view all payments" on public.payments;
create policy "Admins can view all payments"
  on public.payments for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can record a refund" on public.payments;
create policy "Admins can record a refund"
  on public.payments for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Column-level narrowing, same defense-in-depth pattern as 0025: even
-- though the policy above allows the UPDATE command, admin should only
-- ever be able to touch the three refund columns — never amount,
-- status, gateway_tracker_token, or anything the webhook itself owns.
revoke update on public.payments from authenticated;
grant update (refunded_amount, refunded_at, refund_note) on public.payments to authenticated;

-- 3. doctor_payouts: a monthly ledger, one row per doctor per period,
--    generated on demand by admin (not automatically) so it's a
--    deliberate snapshot rather than a live-recalculated number that
--    could silently change after being reported to a doctor. Admin
--    marks it 'paid' once the real bank transfer has actually happened.
create table if not exists public.doctor_payouts (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users (id),
  period_start date not null,
  period_end date not null,
  consultation_count int not null,
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  generated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (doctor_id, period_start, period_end)
);

alter table public.doctor_payouts enable row level security;

drop policy if exists "Admins can manage payouts" on public.doctor_payouts;
create policy "Admins can view payouts"
  on public.doctor_payouts for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

create policy "Admins can create payouts"
  on public.doctor_payouts for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

create policy "Admins can update payouts"
  on public.doctor_payouts for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- A doctor can see their OWN payout history (transparency — they should
-- be able to check what they're owed/have been paid without asking).
drop policy if exists "Doctors can view their own payouts" on public.doctor_payouts;
create policy "Doctors can view their own payouts"
  on public.doctor_payouts for select
  using (doctor_id = auth.uid());

-- 4. patient_feedback: reviews and complaints, admin-only visibility for
--    now (Section 12-style caution: patient-generated content about a
--    doctor should not go live anywhere until there's a real moderation
--    step — public display is explicitly a later decision, not built
--    here). `kind` distinguishes a star-rating "review" from a
--    free-text "complaint" (a complaint may not even be about a
--    specific consultation, so consultation_id is nullable).
create table if not exists public.patient_feedback (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id),
  consultation_id uuid references public.consultations (id) on delete set null,
  doctor_id uuid references auth.users (id),
  kind text not null check (kind in ('review', 'complaint')),
  rating int check (rating between 1 and 5),
  message text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.patient_feedback enable row level security;

drop policy if exists "Account holders can submit feedback" on public.patient_feedback;
create policy "Account holders can submit feedback"
  on public.patient_feedback for insert
  with check (account_id = auth.uid());

drop policy if exists "Account holders can view their own feedback" on public.patient_feedback;
create policy "Account holders can view their own feedback"
  on public.patient_feedback for select
  using (account_id = auth.uid());

drop policy if exists "Admins can view all feedback" on public.patient_feedback;
create policy "Admins can view all feedback"
  on public.patient_feedback for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update feedback status" on public.patient_feedback;
create policy "Admins can update feedback status"
  on public.patient_feedback for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Column-level narrowing for the admin update path: only `status`
-- should ever be admin-editable — never rewriting a patient's own
-- rating/message.
revoke update on public.patient_feedback from authenticated;
grant update (status) on public.patient_feedback to authenticated;

-- No doctor-facing policy on patient_feedback at all, deliberately, per
-- the physician's explicit choice (admin-only for now).
