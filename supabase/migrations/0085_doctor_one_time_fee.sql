-- 0085: doctors pay PKR 2,500 ONCE at registration - no monthly fee.
--
-- Decision: the platform fee is a single payment of PKR 2,500 after the
-- doctor is approved (plus the per-consultation share, unchanged). No
-- recurring subscription, no renewal reminders.
--
-- How it is done with the least change: the existing access rule stays
-- exactly as it is (subscription_status = 'active' AND period end is NULL
-- or in the future - 0067/0068 already accept a NULL end). A paid doctor
-- now simply gets a NULL period end = access with no expiry. Nothing in
-- the lock, the directory view or the doctor/patient flows is rewritten.
--
-- 1. Backup of what is about to change (used by ROLLBACK-0085.sql).
-- 2. Doctors who are active right now keep access for life (period end -> NULL).
--    Doctors who never paid, or whose month already ran out, are NOT touched:
--    they pay the one-time PKR 2,500 through Safepay.
-- 3. Everyone is switched onto the Safepay checkout (the bank/JazzCash form
--    was the fallback for doctors who were mid-subscription).
-- 4. settle_doctor_access_payment() now grants permanent access.

-- 1. backup ------------------------------------------------------------------
create table if not exists public.doctor_fee_0085_backup (
  doctor_id uuid primary key,
  old_subscription_status text,
  old_period_end timestamptz,
  old_use_safepay_checkout boolean,
  saved_at timestamptz not null default now()
);
alter table public.doctor_fee_0085_backup enable row level security;
revoke all on public.doctor_fee_0085_backup from public, anon, authenticated;
grant all on public.doctor_fee_0085_backup to service_role;

insert into public.doctor_fee_0085_backup (doctor_id, old_subscription_status, old_period_end, old_use_safepay_checkout)
select id, subscription_status, subscription_current_period_end, use_safepay_checkout
from public.doctor_profiles
on conflict (doctor_id) do nothing;

-- 2. active doctors keep access for life -------------------------------------
update public.doctor_profiles
set subscription_current_period_end = null,
    subscription_last_event_at = now()
where subscription_status = 'active'
  and subscription_current_period_end is not null
  and subscription_current_period_end > now();

-- 3. everyone uses the Safepay checkout ---------------------------------------
update public.doctor_profiles set use_safepay_checkout = true where use_safepay_checkout = false;

-- 4. a successful payment = access with no end date ---------------------------
create or replace function public.settle_doctor_access_payment(p_payment_id uuid, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.doctor_access_payments%rowtype;
  prof record;
begin
  select * into pay from public.doctor_access_payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'not_found');
  end if;
  if pay.status = 'succeeded' then
    return jsonb_build_object('settled', false, 'reason', 'already_settled', 'period_end', pay.period_end);
  end if;

  select subscription_status into prof
  from public.doctor_profiles
  where id = pay.doctor_id
  for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'doctor_not_found');
  end if;

  update public.doctor_profiles
  set subscription_status = 'active',
      subscription_current_period_end = null,          -- one-time fee: no expiry
      subscription_started_at = coalesce(subscription_started_at, now()),
      subscription_last_event_at = now()
  where id = pay.doctor_id;

  update public.doctor_access_payments
  set status = 'succeeded',
      paid_at = now(),
      period_start = now(),
      period_end = null,
      raw_payload = coalesce(p_raw, raw_payload),
      updated_at = now()
  where id = pay.id;

  insert into public.doctor_subscription_events (doctor_id, event_type, matched, raw_payload)
  values (
    pay.doctor_id,
    'access_payment.succeeded',
    true,
    jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'one_time', true)
  );

  return jsonb_build_object('settled', true, 'period_end', null);
end;
$$;

revoke all on function public.settle_doctor_access_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.settle_doctor_access_payment(uuid, jsonb) to service_role;
