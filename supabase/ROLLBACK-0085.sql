-- Rollback for 0085 (doctor one-time fee). Restores each doctor's previous
-- status / end date / checkout switch from the backup table, puts back the
-- 30-day settle function from 0076, then drops the backup.
-- Doctors who PAID through the new one-time checkout after 0085 keep their
-- access (they are skipped here), so a rollback never takes away access
-- someone has paid for.
update public.doctor_profiles d
set subscription_status = b.old_subscription_status,
    subscription_current_period_end = b.old_period_end,
    use_safepay_checkout = b.old_use_safepay_checkout
from public.doctor_fee_0085_backup b
where b.doctor_id = d.id
  and not exists (
    select 1 from public.doctor_access_payments p
    where p.doctor_id = d.id and p.status = 'succeeded' and p.period_end is null
  );

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
  select subscription_status, subscription_current_period_end into prof
  from public.doctor_profiles where id = pay.doctor_id for update;
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
  set status = 'succeeded', paid_at = now(), period_start = base_ts, period_end = new_end,
      raw_payload = coalesce(p_raw, raw_payload), updated_at = now()
  where id = pay.id;
  insert into public.doctor_subscription_events (doctor_id, event_type, matched, raw_payload)
  values (pay.doctor_id, 'access_payment.succeeded', true,
    jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'period_start', base_ts, 'period_end', new_end));
  return jsonb_build_object('settled', true, 'period_end', new_end);
end;
$$;
revoke all on function public.settle_doctor_access_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.settle_doctor_access_payment(uuid, jsonb) to service_role;

drop table if exists public.doctor_fee_0085_backup;
