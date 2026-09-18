-- Free follow-up, actually wired to payment this time (2026-09-18,
-- physician-confirmed direction (a) of two options offered): the
-- existing `consultation_followups` table (0019) only ever recorded a
-- "standard/waived" note AFTER a follow-up consultation was already
-- booked and paid for through the normal flow -- it had zero
-- connection to booking or payment, confirmed by reading the payment
-- route directly, which never references it at all. A patient marked
-- "waived" was still charged full price. This migration builds the
-- real thing: a doctor, from an already-completed consultation, issues
-- a one-time voucher tied to a specific patient; the patient then sees
-- a "book your free follow-up" option that creates the new
-- consultation directly in 'submitted' status -- no payment page, no
-- Safepay checkout, no payments row at all -- rather than merely
-- annotating a normally-paid booking after the fact.
--
-- Deliberately narrow, mirroring this project's standing pattern for
-- every privileged status transition (cancel_consultation 0037,
-- assign_default_doctor 0015, mark_consultation_completed_on_issue
-- 0018): three security-definer functions are the ONLY way a voucher
-- can be created, revoked, or redeemed. No direct table grants to
-- `authenticated` at all -- not even the same "own consultation, own
-- doctor" table-policy style 0019 used, because redemption needs to
-- INSERT a `consultations` row with `status = 'submitted'` directly,
-- and `status` is deliberately outside `authenticated`'s column grant
-- since 0014.
--
-- A free follow-up still counts against the doctor's own daily patient
-- cap (0033) and text-availability window (0031), and slot capacity
-- (0021) for audio/video -- it consumes real appointment time, so it
-- is not exempt from any of those checks. It generates no payment row,
-- so it is automatically excluded from revenue and doctor-payout
-- calculations (confirmed by reading /admin/payouts' own query: a
-- consultation with no matching payments row is treated exactly like
-- "no successful charge on file", the same as it already does for any
-- other unpaid consultation) -- this migration does NOT invent any
-- separate doctor compensation for a free follow-up; if the physician
-- wants the doctor paid anyway for goodwill follow-ups, that's a
-- distinct, separate decision to make explicitly, not assumed here.

create table public.consultation_followup_vouchers (
  id uuid primary key default gen_random_uuid(),
  origin_consultation_id uuid not null references public.consultations (id) on delete cascade,
  patient_id uuid not null references public.family_members (id) on delete cascade,
  doctor_id uuid not null references auth.users (id),
  issued_by uuid not null references auth.users (id),
  note text,
  status text not null default 'active' check (status in ('active', 'consumed', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  consumed_consultation_id uuid references public.consultations (id) on delete set null,
  consumed_at timestamptz,
  revoked_at timestamptz
);

-- Only one live voucher per origin consultation at a time -- prevents
-- a doctor accidentally double-clicking "grant" from creating two
-- redeemable freebies for one visit. A revoked or already-consumed
-- voucher doesn't block issuing a fresh one (e.g. the doctor revoked a
-- mistaken grant, or the patient already used one and comes back
-- again later for the same original complaint).
create unique index consultation_followup_vouchers_one_active_per_origin
  on public.consultation_followup_vouchers (origin_consultation_id)
  where status = 'active';

create index consultation_followup_vouchers_patient_idx
  on public.consultation_followup_vouchers (patient_id)
  where status = 'active';

alter table public.consultation_followup_vouchers enable row level security;

-- Read-only for everyone who has a legitimate reason to see one --
-- writes only ever happen through the three functions below.
drop policy if exists "Account holders can view their family's vouchers" on public.consultation_followup_vouchers;
create policy "Account holders can view their family's vouchers"
  on public.consultation_followup_vouchers for select
  using (
    patient_id in (select id from public.family_members where account_id = auth.uid())
  );

drop policy if exists "Doctors can view vouchers they issued" on public.consultation_followup_vouchers;
create policy "Doctors can view vouchers they issued"
  on public.consultation_followup_vouchers for select
  using (doctor_id = auth.uid());

drop policy if exists "Admins can view all vouchers" on public.consultation_followup_vouchers;
create policy "Admins can view all vouchers"
  on public.consultation_followup_vouchers for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- 1. Issue: only the doctor actually assigned to a COMPLETED
--    consultation can grant a free follow-up from it -- not a doctor
--    browsing someone else's patient, and not from a consultation
--    that's still open (the natural moment to decide "come back and
--    I won't charge you for it" is when wrapping up the visit, same
--    as when the existing FollowUpSettings control is normally used).
create or replace function public.issue_followup_voucher(
  p_consultation_id uuid,
  p_note text default null,
  p_expires_in_days int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_doctor_id uuid;
  v_status text;
  v_voucher_id uuid;
begin
  select patient_id, doctor_id, status into v_patient_id, v_doctor_id, v_status
  from public.consultations
  where id = p_consultation_id;

  if v_status is null then
    raise exception 'Consultation not found.';
  end if;

  if v_doctor_id is distinct from auth.uid() then
    raise exception 'You are not authorized to grant a follow-up for this consultation.';
  end if;

  if v_status is distinct from 'completed' then
    raise exception 'A free follow-up can only be granted from a completed consultation.';
  end if;

  if exists (
    select 1 from public.consultation_followup_vouchers
    where origin_consultation_id = p_consultation_id and status = 'active'
  ) then
    raise exception 'A free follow-up has already been granted for this consultation.';
  end if;

  if p_expires_in_days is not null and p_expires_in_days <= 0 then
    raise exception 'Expiry must be a positive number of days.';
  end if;

  insert into public.consultation_followup_vouchers
    (origin_consultation_id, patient_id, doctor_id, issued_by, note, expires_at)
  values (
    p_consultation_id,
    v_patient_id,
    v_doctor_id,
    auth.uid(),
    nullif(trim(p_note), ''),
    case when p_expires_in_days is not null then now() + (p_expires_in_days || ' days')::interval else null end
  )
  returning id into v_voucher_id;

  return v_voucher_id;
end;
$$;

grant execute on function public.issue_followup_voucher(uuid, text, int) to authenticated;

-- 2. Revoke: lets the issuing doctor undo a mistaken grant before the
--    patient uses it. Does not touch a consumed voucher -- once
--    redeemed, the real consultation it created stands on its own and
--    is handled like any other (e.g. via cancel_consultation, 0037),
--    not by reaching back through the voucher.
create or replace function public.revoke_followup_voucher(p_voucher_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_id uuid;
  v_status text;
begin
  select doctor_id, status into v_doctor_id, v_status
  from public.consultation_followup_vouchers
  where id = p_voucher_id;

  if v_status is null then
    raise exception 'Voucher not found.';
  end if;
  if v_doctor_id is distinct from auth.uid() then
    raise exception 'You are not authorized to revoke this voucher.';
  end if;
  if v_status = 'consumed' then
    raise exception 'This free follow-up has already been used and can no longer be revoked.';
  end if;
  if v_status = 'revoked' then
    raise exception 'This free follow-up was already revoked.';
  end if;

  update public.consultation_followup_vouchers
  set status = 'revoked', revoked_at = now()
  where id = p_voucher_id;
end;
$$;

grant execute on function public.revoke_followup_voucher(uuid) to authenticated;

-- 3. Redeem: the ONLY way a `consultations` row can be created with
--    `status = 'submitted'` directly, skipping 'pending_payment' and
--    every payment step entirely -- security definer specifically so
--    it can write `status` at all (outside `authenticated`'s column
--    grant since 0014), the same justification every other
--    status-writing function in this project already documents.
--    Every other insert trigger on `consultations` (assign_default_doctor,
--    enforce_slot_capacity, enforce_daily_patient_cap,
--    enforce_text_availability) still fires normally on this insert,
--    since triggers apply regardless of who performs the insert -- a
--    free follow-up still has to fit the doctor's real daily capacity
--    and slot availability like any other booking.
create or replace function public.redeem_followup_voucher(
  p_voucher_id uuid,
  p_complaint text,
  p_delivery_mode text,
  p_slot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_doctor_id uuid;
  v_origin_consultation_id uuid;
  v_status text;
  v_expires_at timestamptz;
  v_owns boolean;
  v_new_consultation_id uuid;
begin
  select patient_id, doctor_id, origin_consultation_id, status, expires_at
    into v_patient_id, v_doctor_id, v_origin_consultation_id, v_status, v_expires_at
  from public.consultation_followup_vouchers
  where id = p_voucher_id;

  if v_status is null then
    raise exception 'This free follow-up link is not valid.';
  end if;

  select exists (
    select 1 from public.family_members
    where id = v_patient_id and account_id = auth.uid()
  ) into v_owns;
  if not v_owns then
    raise exception 'You are not authorized to use this free follow-up.';
  end if;

  if v_status = 'consumed' then
    raise exception 'This free follow-up has already been used.';
  end if;
  if v_status = 'revoked' then
    raise exception 'This free follow-up was cancelled by the doctor.';
  end if;
  if v_expires_at is not null and v_expires_at < now() then
    raise exception 'This free follow-up has expired.';
  end if;

  insert into public.consultations (patient_id, doctor_id, complaint, delivery_mode, slot_id, status)
  values (v_patient_id, v_doctor_id, p_complaint, p_delivery_mode, p_slot_id, 'submitted')
  returning id into v_new_consultation_id;

  update public.consultation_followup_vouchers
  set status = 'consumed', consumed_consultation_id = v_new_consultation_id, consumed_at = now()
  where id = p_voucher_id;

  -- Reuse the existing follow-up record (0019) rather than inventing a
  -- second place that says "this consultation is a waived follow-up" --
  -- the doctor's own /doctor/consultations/[id] workspace already
  -- knows how to show this via FollowUpSettings.
  insert into public.consultation_followups (consultation_id, follow_up_to, fee_status, doctor_id)
  values (v_new_consultation_id, v_origin_consultation_id, 'waived', v_doctor_id)
  on conflict (consultation_id) do nothing;

  return v_new_consultation_id;
end;
$$;

grant execute on function public.redeem_followup_voucher(uuid, text, text, uuid) to authenticated;
