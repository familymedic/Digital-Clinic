-- 0076: doctor platform access paid through a Safepay checkout (PKR 2,500 for 30 days).
--
-- Why: the manual bank-transfer / JazzCash route is slow and troublesome.
-- A doctor can now pay the platform fee through the same Safepay checkout
-- patients already use. Payment → 30 days of access. At the end of the
-- period the doctor is locked until the next payment.
--
-- What this adds (nothing existing is changed or removed):
--   1. doctor_profiles.use_safepay_checkout   - which doctors pay through
--      Safepay. Doctors who were already "unpaid" when this runs, and the
--      four approved-but-unpaid doctors named below, are switched ON now.
--      Every NEW doctor registration defaults to ON. Doctors who are
--      mid-subscription stay OFF (nothing changes for them) until you
--      choose to switch everyone on:
--          update public.doctor_profiles set use_safepay_checkout = true;
--   2. doctor_access_payments                 - one row per checkout started.
--   3. settle_doctor_access_payment()         - the single, atomic place a
--      successful payment turns into days of access. Safe to call twice.
--
-- Access rules are NOT touched: the existing rule stays exactly as is
-- (subscription_status = 'active' AND period end in the future, 0043/0044,
-- and the directory view from 0068). Paying simply sets those two fields.
-- Admin "Mark paid" / "Mark unpaid" on /admin/subscriptions keep working.

-- 1. which doctors use the Safepay checkout ---------------------------------
alter table public.doctor_profiles
  add column if not exists use_safepay_checkout boolean not null default false;

-- Switch ON: every doctor who has not paid yet, plus the four named doctors.
update public.doctor_profiles
set use_safepay_checkout = true
where subscription_status = 'unpaid'
   or lower(email) in (
     'drfarhanakmdc@gmail.com',
     'androfertilitycare@gmail.com',
     'shirazmalik114@gmail.com',
     'sajidajamro88@gmail.com'
   );

-- From now on every newly registered doctor starts on the Safepay checkout.
alter table public.doctor_profiles
  alter column use_safepay_checkout set default true;

-- 2. one row per checkout ---------------------------------------------------
create table if not exists public.doctor_access_payments (
  id uuid primary key,                       -- our own id; goes to Safepay as metadata.order_id
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  amount integer not null check (amount > 0),  -- PKR, whole rupees
  currency text not null default 'PKR',
  gateway text not null default 'safepay',
  gateway_environment text not null,         -- 'production' or 'sandbox'
  gateway_tracker_token text,
  status text not null default 'pending' check (status in ('pending', 'succeeded')),
  period_start timestamptz,                  -- set when the payment succeeds
  period_end timestamptz,
  paid_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists doctor_access_payments_tracker_uidx
  on public.doctor_access_payments (gateway_tracker_token)
  where gateway_tracker_token is not null;
create index if not exists doctor_access_payments_doctor_idx
  on public.doctor_access_payments (doctor_id, created_at desc);

alter table public.doctor_access_payments enable row level security;

drop policy if exists "Doctors can view their own access payments" on public.doctor_access_payments;
create policy "Doctors can view their own access payments"
  on public.doctor_access_payments for select
  using (doctor_id = auth.uid());

drop policy if exists "Admins can view all access payments" on public.doctor_access_payments;
create policy "Admins can view all access payments"
  on public.doctor_access_payments for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- No INSERT / UPDATE / DELETE policy for anyone: only the server (service
-- role) writes here, exactly like `payments` (0024). Read access is stated
-- explicitly (the policies above decide who actually sees which rows).
grant select on public.doctor_access_payments to authenticated;
grant all on public.doctor_access_payments to service_role;

-- 3. settle a successful payment -------------------------------------------
-- New period = 30 days after whichever is LATER: now, or the end of the
-- doctor's current paid period. So paying early never wastes days.
create or replace function public.settle_doctor_access_payment(p_payment_id uuid, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.doctor_access_payments%rowtype;
  prof record;
  base_ts timestamptz;
  new_end timestamptz;
begin
  select * into pay from public.doctor_access_payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'not_found');
  end if;
  if pay.status = 'succeeded' then
    return jsonb_build_object('settled', false, 'reason', 'already_settled', 'period_end', pay.period_end);
  end if;

  select subscription_status, subscription_current_period_end
    into prof
  from public.doctor_profiles
  where id = pay.doctor_id
  for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'doctor_not_found');
  end if;

  base_ts := now();
  if prof.subscription_status = 'active'
     and prof.subscription_current_period_end is not null
     and prof.subscription_current_period_end > base_ts then
    base_ts := prof.subscription_current_period_end;
  end if;
  new_end := base_ts + interval '30 days';

  update public.doctor_profiles
  set subscription_status = 'active',
      subscription_current_period_end = new_end,
      subscription_started_at = coalesce(subscription_started_at, now()),
      subscription_last_event_at = now()
  where id = pay.doctor_id;

  update public.doctor_access_payments
  set status = 'succeeded',
      paid_at = now(),
      period_start = base_ts,
      period_end = new_end,
      raw_payload = coalesce(p_raw, raw_payload),
      updated_at = now()
  where id = pay.id;

  insert into public.doctor_subscription_events (doctor_id, event_type, matched, raw_payload)
  values (
    pay.doctor_id,
    'access_payment.succeeded',
    true,
    jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'period_start', base_ts, 'period_end', new_end)
  );

  return jsonb_build_object('settled', true, 'period_end', new_end);
end;
$$;

revoke all on function public.settle_doctor_access_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.settle_doctor_access_payment(uuid, jsonb) to service_role;
