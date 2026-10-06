-- Doctor earnings and payout requests (2026-10-05, physician request):
-- doctors need to see what they've earned after the platform's share,
-- save bank details (or choose to email them), request a payout, and see
-- it settle; the admin needs to see who is waiting to be paid.
--
-- Money model (unchanged): payments.doctor_share is already the doctor's
-- cut of each charge (fee minus the PKR 150/200/250 platform share, or an
-- admin-agreed share above PKR 1,500). A payment is PAYABLE when it
--   - succeeded, was not refunded, and has a recorded doctor_share,
--   - belongs to a COMPLETED consultation, and that consultation has been
--     completed for at least hold_days (default 3) - this covers the
--     same-day refund window and Safepay's settlement lag,
--   - was made in PRODUCTION (sandbox/test payments never count, unless an
--     admin explicitly switches that on to test this feature),
--   - is not already claimed by another payout.
-- A payout CLAIMS the payments it covers (payments.payout_id), inside one
-- locked step, so the same consultation can never be paid twice and a
-- doctor can never request more than the server computes. When the admin
-- marks a payout paid, the claimed payments are settled and the doctor's
-- available balance for them is already zero; new earnings start fresh.
--
-- Everything here is additive. Existing payout rows keep working.

-- 0. Settings (one row) --------------------------------------------------
create table if not exists public.payout_settings (
  id boolean primary key default true check (id),
  hold_days int not null default 3 check (hold_days between 0 and 60),
  min_payout int not null default 2000 check (min_payout >= 0),
  include_test_payments boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.payout_settings (id) values (true) on conflict do nothing;
alter table public.payout_settings enable row level security;

drop policy if exists "Admins can view payout settings" on public.payout_settings;
create policy "Admins can view payout settings"
  on public.payout_settings for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));
drop policy if exists "Admins can update payout settings" on public.payout_settings;
create policy "Admins can update payout settings"
  on public.payout_settings for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- 1. When a consultation was completed (needed for the hold period) ------
alter table public.consultations add column if not exists completed_at timestamptz;

create or replace function public.set_consultation_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists on_consultation_set_completed_at on public.consultations;
create trigger on_consultation_set_completed_at
  before update on public.consultations
  for each row execute function public.set_consultation_completed_at();

-- 2. Payments: which gateway environment, and which payout claimed it ----
-- gateway_environment is written by the payment route from now on; rows
-- created before this migration are NULL and are treated as test data.
alter table public.payments add column if not exists gateway_environment text;
alter table public.payments add column if not exists payout_id uuid references public.doctor_payouts (id) on delete set null;
create index if not exists payments_payout_id_idx on public.payments (payout_id);

-- 3. doctor_payouts: widen for doctor requests ---------------------------
alter table public.doctor_payouts
  add column if not exists source text not null default 'admin',
  add column if not exists requested_at timestamptz,
  add column if not exists bank_snapshot jsonb,
  add column if not exists details_via_email boolean not null default false,
  add column if not exists transfer_reference text,
  add column if not exists note text,
  add column if not exists paid_by uuid references auth.users (id),
  add column if not exists cancelled_at timestamptz;

do $$
declare c record;
begin
  -- status: was ('pending','paid'); now also 'requested' and 'cancelled'.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.doctor_payouts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.doctor_payouts drop constraint %I', c.conname);
  end loop;
  -- one payout per doctor+period was the monthly-snapshot rule; payouts are
  -- now claims on individual payments, so several can share a period.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.doctor_payouts'::regclass and contype = 'u'
  loop
    execute format('alter table public.doctor_payouts drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.doctor_payouts
  add constraint doctor_payouts_status_check check (status in ('requested', 'pending', 'paid', 'cancelled'));
alter table public.doctor_payouts
  drop constraint if exists doctor_payouts_source_check;
alter table public.doctor_payouts
  add constraint doctor_payouts_source_check check (source in ('admin', 'doctor_request'));

-- 4. Doctor payout details (bank / wallet) -------------------------------
create table if not exists public.doctor_payout_details (
  doctor_id uuid primary key references auth.users (id) on delete cascade,
  account_title text check (account_title is null or char_length(account_title) <= 120),
  bank_name text check (bank_name is null or char_length(bank_name) <= 120),
  account_number text check (account_number is null or account_number ~ '^[A-Za-z0-9 -]{6,40}$'),
  wallet_provider text check (wallet_provider is null or wallet_provider in ('jazzcash', 'easypaisa')),
  wallet_number text check (wallet_number is null or wallet_number ~ '^[0-9+ -]{9,20}$'),
  details_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_details_has_destination check (
    (coalesce(trim(account_number), '') <> '' and coalesce(trim(account_title), '') <> '' and coalesce(trim(bank_name), '') <> '')
    or (coalesce(trim(wallet_number), '') <> '' and wallet_provider is not null)
  )
);
alter table public.doctor_payout_details enable row level security;

drop policy if exists "Doctors can view their own payout details" on public.doctor_payout_details;
create policy "Doctors can view their own payout details"
  on public.doctor_payout_details for select
  using (doctor_id = auth.uid());
drop policy if exists "Doctors can add their own payout details" on public.doctor_payout_details;
create policy "Doctors can add their own payout details"
  on public.doctor_payout_details for insert
  with check (doctor_id = auth.uid() and exists (select 1 from public.doctor_profiles where id = auth.uid()));
drop policy if exists "Doctors can update their own payout details" on public.doctor_payout_details;
create policy "Doctors can update their own payout details"
  on public.doctor_payout_details for update
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid());
drop policy if exists "Admins can view payout details" on public.doctor_payout_details;
create policy "Admins can view payout details"
  on public.doctor_payout_details for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Flag recent changes so the admin can double-check before paying out.
create or replace function public.touch_payout_details()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT'
     or new.account_title is distinct from old.account_title
     or new.bank_name is distinct from old.bank_name
     or new.account_number is distinct from old.account_number
     or new.wallet_provider is distinct from old.wallet_provider
     or new.wallet_number is distinct from old.wallet_number then
    new.details_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists on_payout_details_touch on public.doctor_payout_details;
create trigger on_payout_details_touch
  before insert or update on public.doctor_payout_details
  for each row execute function public.touch_payout_details();

-- 5. Internal: every payment of a doctor with its payout state -----------
create or replace function public._doctor_payment_rows(p_doctor_id uuid)
returns table (
  payment_id uuid,
  occurred_at timestamptz,
  delivery_mode text,
  fee int,
  platform_share int,
  doctor_share int,
  state text,
  payout_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (select hold_days, include_test_payments from public.payout_settings limit 1)
  select
    p.id,
    coalesce(c.completed_at, p.created_at),
    c.delivery_mode,
    p.amount,
    p.platform_share,
    p.doctor_share,
    case
      when p.payout_id is not null and po.status = 'paid' then 'paid'
      when p.payout_id is not null then 'requested'
      when c.status <> 'completed' then 'awaiting_completion'
      when coalesce(c.completed_at, p.created_at) + make_interval(days => s.hold_days) > now() then 'in_hold'
      else 'available'
    end,
    p.payout_id
  from public.payments p
  join public.consultations c on c.id = p.consultation_id
  left join public.doctor_payouts po on po.id = p.payout_id
  cross join s
  where c.doctor_id = p_doctor_id
    and p.status = 'succeeded'
    and p.refunded_amount is null
    and p.doctor_share is not null
    and (p.gateway_environment = 'production' or s.include_test_payments);
$$;
revoke all on function public._doctor_payment_rows(uuid) from public, anon, authenticated;

-- 6. Internal: claim payments into a new payout --------------------------
create or replace function public._create_payout(
  p_doctor_id uuid,
  p_include_hold boolean,
  p_source text,
  p_status text,
  p_enforce_min boolean,
  p_via_email boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_sum int;
  v_count int;
  v_first timestamptz;
  v_last timestamptz;
  v_min int;
  v_snapshot jsonb;
  v_id uuid;
  v_updated int;
begin
  perform pg_advisory_xact_lock(hashtextextended('payout:' || p_doctor_id::text, 0));

  if exists (
    select 1 from public.doctor_payouts
    where doctor_id = p_doctor_id and status in ('requested', 'pending')
  ) then
    raise exception 'A payout is already in progress for this doctor. It needs to be paid or cancelled first.';
  end if;

  select array_agg(r.payment_id), coalesce(sum(r.doctor_share), 0)::int, count(*)::int,
         min(r.occurred_at), max(r.occurred_at)
    into v_ids, v_sum, v_count, v_first, v_last
  from public._doctor_payment_rows(p_doctor_id) r
  where r.state = 'available' or (p_include_hold and r.state = 'in_hold');

  if v_count = 0 then
    raise exception 'There is nothing available to pay out yet.';
  end if;

  select min_payout into v_min from public.payout_settings limit 1;
  if p_enforce_min and v_sum < v_min then
    raise exception 'The minimum payout is PKR %. Your available balance is PKR %.', v_min, v_sum;
  end if;

  select to_jsonb(d) - 'doctor_id' into v_snapshot
  from public.doctor_payout_details d where d.doctor_id = p_doctor_id;

  if p_source = 'doctor_request' and v_snapshot is null and not p_via_email then
    raise exception 'Please save your bank details first, or choose to email them to contact@thefamilymedic.com.';
  end if;

  insert into public.doctor_payouts (
    doctor_id, period_start, period_end, consultation_count, amount, status,
    source, requested_at, bank_snapshot, details_via_email
  ) values (
    p_doctor_id, (v_first at time zone 'Asia/Karachi')::date, (v_last at time zone 'Asia/Karachi')::date,
    v_count, v_sum, p_status,
    p_source, case when p_source = 'doctor_request' then now() end,
    v_snapshot, coalesce(p_via_email, false)
  ) returning id into v_id;

  update public.payments
  set payout_id = v_id
  where id = any (v_ids) and payout_id is null and refunded_amount is null;
  get diagnostics v_updated = row_count;

  if v_updated <> v_count then
    raise exception 'Some payments changed while the payout was being prepared. Please try again.';
  end if;

  return v_id;
end;
$$;
revoke all on function public._create_payout(uuid, boolean, text, text, boolean, boolean) from public, anon, authenticated;

-- 7. Internal: release a payout's payments back to the doctor's balance --
create or replace function public._release_payout(p_payout_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payments set payout_id = null where payout_id = p_payout_id;
  update public.doctor_payouts
  set status = 'cancelled', cancelled_at = now(), note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_payout_id;
end;
$$;
revoke all on function public._release_payout(uuid, text) from public, anon, authenticated;

-- 8. Doctor-facing API ----------------------------------------------------
create or replace function public.doctor_earnings_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
  v_result jsonb;
  v_open jsonb;
begin
  if v_doc is null or not exists (select 1 from public.doctor_profiles where id = v_doc) then
    raise exception 'This is only available to doctor accounts.';
  end if;

  select jsonb_build_object(
    'available',       coalesce(sum(r.doctor_share) filter (where r.state = 'available'), 0),
    'available_count', count(*) filter (where r.state = 'available'),
    'upcoming',        coalesce(sum(r.doctor_share) filter (where r.state in ('in_hold', 'awaiting_completion')), 0),
    'in_progress',     coalesce(sum(r.doctor_share) filter (where r.state = 'requested'), 0),
    'paid_total',      coalesce(sum(r.doctor_share) filter (where r.state = 'paid'), 0),
    'lifetime',        coalesce(sum(r.doctor_share), 0)
  ) into v_result
  from public._doctor_payment_rows(v_doc) r;

  select to_jsonb(po) into v_open
  from (
    select id, status, amount, consultation_count, requested_at, details_via_email, source
    from public.doctor_payouts
    where doctor_id = v_doc and status in ('requested', 'pending')
    order by created_at desc limit 1
  ) po;

  return v_result || jsonb_build_object(
    'open_payout', v_open,
    'min_payout', (select min_payout from public.payout_settings limit 1),
    'hold_days',  (select hold_days from public.payout_settings limit 1)
  );
end;
$$;
grant execute on function public.doctor_earnings_summary() to authenticated;

create or replace function public.doctor_earnings_lines(p_limit int default 200)
returns table (
  occurred_at timestamptz,
  delivery_mode text,
  fee int,
  platform_share int,
  doctor_share int,
  state text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
begin
  if v_doc is null or not exists (select 1 from public.doctor_profiles where id = v_doc) then
    raise exception 'This is only available to doctor accounts.';
  end if;
  return query
    select r.occurred_at, r.delivery_mode, r.fee, r.platform_share, r.doctor_share, r.state
    from public._doctor_payment_rows(v_doc) r
    order by r.occurred_at desc
    limit greatest(least(coalesce(p_limit, 200), 500), 1);
end;
$$;
grant execute on function public.doctor_earnings_lines(int) to authenticated;

create or replace function public.request_payout(p_via_email boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
begin
  if v_doc is null or not exists (select 1 from public.doctor_profiles where id = v_doc) then
    raise exception 'This is only available to doctor accounts.';
  end if;
  return public._create_payout(v_doc, false, 'doctor_request', 'requested', true, coalesce(p_via_email, false));
end;
$$;
grant execute on function public.request_payout(boolean) to authenticated;

create or replace function public.cancel_payout_request(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := auth.uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('payout:' || v_doc::text, 0));
  if not exists (
    select 1 from public.doctor_payouts
    where id = p_payout_id and doctor_id = v_doc and status = 'requested'
  ) then
    raise exception 'That payout request can no longer be cancelled.';
  end if;
  perform public._release_payout(p_payout_id, 'Cancelled by the doctor.');
end;
$$;
grant execute on function public.cancel_payout_request(uuid) to authenticated;

-- 9. Admin-facing API ------------------------------------------------------
create or replace function public.admin_doctor_balances()
returns table (
  doctor_id uuid,
  full_name text,
  available int,
  upcoming int,
  in_progress int,
  paid_total int,
  has_bank_details boolean,
  details_changed_at timestamptz,
  open_payout_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  return query
    select
      dp.id,
      dp.full_name,
      coalesce(sum(r.doctor_share) filter (where r.state = 'available'), 0)::int,
      coalesce(sum(r.doctor_share) filter (where r.state in ('in_hold', 'awaiting_completion')), 0)::int,
      coalesce(sum(r.doctor_share) filter (where r.state = 'requested'), 0)::int,
      coalesce(sum(r.doctor_share) filter (where r.state = 'paid'), 0)::int,
      (pd.doctor_id is not null),
      pd.details_changed_at,
      (select po.id from public.doctor_payouts po
        where po.doctor_id = dp.id and po.status in ('requested', 'pending')
        order by po.created_at desc limit 1)
    from public.doctor_profiles dp
    left join public.doctor_payout_details pd on pd.doctor_id = dp.id
    left join lateral public._doctor_payment_rows(dp.id) r on true
    group by dp.id, dp.full_name, pd.doctor_id, pd.details_changed_at
    order by dp.full_name;
end;
$$;
grant execute on function public.admin_doctor_balances() to authenticated;

create or replace function public.admin_generate_payout(p_doctor_id uuid, p_ignore_hold boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  return public._create_payout(p_doctor_id, coalesce(p_ignore_hold, false), 'admin', 'pending', false, false);
end;
$$;
grant execute on function public.admin_generate_payout(uuid, boolean) to authenticated;

create or replace function public.admin_mark_payout_paid(p_payout_id uuid, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  update public.doctor_payouts
  set status = 'paid', paid_at = now(), paid_by = auth.uid(),
      transfer_reference = nullif(trim(coalesce(p_reference, '')), '')
  where id = p_payout_id and status in ('requested', 'pending');
  if not found then
    raise exception 'That payout is not awaiting payment.';
  end if;
end;
$$;
grant execute on function public.admin_mark_payout_paid(uuid, text) to authenticated;

create or replace function public.admin_reject_payout(p_payout_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  if not exists (select 1 from public.doctor_payouts where id = p_payout_id and status in ('requested', 'pending')) then
    raise exception 'That payout is not awaiting payment.';
  end if;
  perform public._release_payout(p_payout_id, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Declined by the admin.'));
end;
$$;
grant execute on function public.admin_reject_payout(uuid, text) to authenticated;

-- 10. Alert the admin when a doctor requests a payout ----------------------
-- Same fail-open push mechanism as every other notification in the project
-- (0055/0056/0057): never blocks the request if push isn't configured.
create or replace function public.notify_admin_of_payout_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push_secret text;
  v_site_url text;
  v_name text;
begin
  if new.source <> 'doctor_request' then
    return new;
  end if;
  begin
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    select decrypted_secret into v_site_url from vault.decrypted_secrets where name = 'site_base_url' limit 1;
    if coalesce(v_push_secret, '') = '' or coalesce(v_site_url, '') = '' then
      return new;
    end if;
    select dp.full_name into v_name from public.doctor_profiles dp where dp.id = new.doctor_id;
    perform net.http_post(
      url := rtrim(v_site_url, '/') || '/api/push/send',
      headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'broadcastRole', 'admin',
        'title', 'Payout requested',
        'body', coalesce(v_name, 'A doctor') || ' requested a payout of PKR ' || new.amount::text || '.',
        'url', '/admin/payouts'
      )
    );
  exception when others then
    raise warning 'notify_admin_of_payout_request: notification failed, request still recorded: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists on_payout_requested_notify_admin on public.doctor_payouts;
create trigger on_payout_requested_notify_admin
  after insert on public.doctor_payouts
  for each row execute function public.notify_admin_of_payout_request();

-- 11. Refund safety -------------------------------------------------------
-- A refund recorded on a payment that is already inside a payout awaiting
-- transfer would leave that payout over-stated (the doctor would be paid
-- for a refunded consultation). Refuse it with a clear instruction: decline
-- the payout first (its amounts return to the doctor's balance, where the
-- refund then excludes this consultation), then record the refund.
-- A payout that is already PAID is not blocked - the refund is recorded and
-- the admin handles any recovery with the doctor directly.
create or replace function public.guard_refund_on_open_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refunded_amount is not null
     and old.refunded_amount is null
     and new.payout_id is not null
     and exists (
       select 1 from public.doctor_payouts po
       where po.id = new.payout_id and po.status in ('requested', 'pending')
     ) then
    raise exception
      'This consultation is part of a doctor payout that is awaiting payment. Decline that payout first (Admin > Doctor payouts), then record the refund.';
  end if;
  return new;
end;
$$;
drop trigger if exists on_payment_refund_guard_payout on public.payments;
create trigger on_payment_refund_guard_payout
  before update of refunded_amount on public.payments
  for each row execute function public.guard_refund_on_open_payout();
