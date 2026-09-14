-- Phase 10, step 2: wire each doctor's own consultation_fee (0027) into
-- the real payment-collection route and the payout ledger (0026),
-- replacing the fixed PKR 500 / PKR 350 numbers those were deliberately
-- built with, before doctor-set fees existed. Confirmed with the
-- physician (2026-09-13/14): the fee tiers already live in
-- src/lib/platformFee.ts (PKR 150/200/250 platform share up to PKR
-- 1,500; a fee above that needs a separate, explicit admin approval).
--
-- One real schema gap had to be closed to do this: nothing anywhere
-- stored the SPECIFIC platform-share amount an admin agrees with a
-- doctor whose fee exceeds PKR 1,500 — computePlatformFeeShare()
-- deliberately returns `requiresApproval: true` with no number for that
-- case, and the step-1 admin screen's `approveFee()` only ever flipped
-- fee_status without recording a split. This migration adds that column,
-- and the admin screen (same commit) now asks for the number before it
-- will activate a doctor in that tier.
--
-- 1. doctor_profiles gains the missing number. Nullable — only ever set
--    for a doctor whose fee is above PKR 1,500; every doctor at or below
--    that uses the pure computePlatformFeeShare() tiers and never
--    touches this column. The cross-column check keeps the platform's
--    share sane relative to whatever fee is on file at the moment it's
--    set — it is NOT re-validated automatically if consultation_fee
--    changes afterward, same "admin explicitly revisits it" expectation
--    fee_status already carries.
alter table public.doctor_profiles
  add column if not exists custom_platform_share int;

alter table public.doctor_profiles
  drop constraint if exists doctor_profiles_custom_platform_share_check;

alter table public.doctor_profiles
  add constraint doctor_profiles_custom_platform_share_check
  check (
    custom_platform_share is null
    or (
      consultation_fee is not null
      and custom_platform_share >= 0
      and custom_platform_share < consultation_fee
    )
  );

-- No RLS/grant change needed for this column: doctor_profiles has no
-- doctor-facing UPDATE policy at all (only the admin-gated one from
-- 0026, unrestricted at the column level, already checked when 0027 was
-- written) and no self-registration path touches it either — so this
-- new column is reachable only the same way every other admin-only
-- column already is.

-- 2. payments records, permanently, exactly what a specific charge was
--    split into at the moment it was charged — never a number derived
--    later from the doctor's CURRENT fee or tier, which can change
--    going forward. This is what makes a generated payout a true
--    historical snapshot (the principle 0026 already states) even after
--    a doctor's fee or platform-share agreement changes later. Nullable
--    because rows already in this table (from before this migration)
--    have no such split recorded — the payout query (app-side) treats
--    that as a data gap to flag, never silently zero.
alter table public.payments
  add column if not exists platform_share int,
  add column if not exists doctor_share int;

-- No RLS/grant change needed here either: payments has no INSERT policy
-- for anyone (service-role only, 0024) and the admin UPDATE path is
-- already column-narrowed to just the three refund columns (0027) — so
-- these two new columns stay unreachable from the `authenticated` role
-- for both tables, verified here rather than assumed, the same
-- defense-in-depth pattern used throughout this project.
