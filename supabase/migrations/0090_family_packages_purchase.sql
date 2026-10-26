-- Family packages, part 3 of 4: buying a pack, who brought the family, and
-- paying the doctor (2026-10-26).
--
--   * package_begin_purchase   - the server's one place that checks a buyer may
--     buy, works out who brought the family (doctor or platform), saves the
--     terms and shares as they are TODAY, and creates the pending purchase
--     (its id goes to Safepay as metadata.order_id).
--   * settle_package_purchase  - a paid purchase becomes live. Safe to call
--     twice (webhook and "confirm on return" may both arrive). Carries unused
--     credits into a renewal when the pack allows it.
--   * admin_package_set_source - the admin can change doctor/platform with a
--     written reason (shares are recalculated).
--   * admin_package_payouts / admin_package_mark_paid - what each doctor is
--     owed, and recording that you paid them (netting any refunds).
--   * admin_package_refund     - pro-rata refund record (the money itself is
--     returned in the Safepay dashboard, as for consultation refunds).
--
-- Only the server (service role) can begin or settle a purchase. Patients and
-- doctors cannot call them from the browser.
-- Requires 0088 and 0089. ROLLBACK: ROLLBACK-0090.sql.

-- 1. Who brought the family ---------------------------------------------------
-- Order of the rules (agreed 2026-10-26):
--   a. A renewal keeps the tag of the family's earlier pack with this doctor.
--   b. The doctor put the family's mobile number on their invite list -> doctor.
--   c. The family's first-touch referral link is this doctor's, and it was
--      recorded before the family's first normal booking on the platform -> doctor.
--   d. Otherwise -> platform.
create or replace function public.package_attribution(p_account uuid, p_doctor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prior public.family_package_purchases%rowtype;
  v_phone text;
  v_ref timestamptz;
  v_ref_doc uuid;
  v_first timestamptz;
begin
  select * into v_prior
  from public.family_package_purchases
  where account_id = p_account and doctor_id = p_doctor and status in ('active', 'refunded')
  order by created_at asc limit 1;
  if found then
    return jsonb_build_object('source', v_prior.source, 'reason', 'Renewal keeps the earlier tag');
  end if;

  select public.package_norm_phone(raw_user_meta_data ->> 'phone') into v_phone from auth.users where id = p_account;
  if v_phone is not null and exists (
    select 1 from public.family_package_invites where doctor_id = p_doctor and phone_norm = v_phone
  ) then
    return jsonb_build_object('source', 'doctor', 'reason', 'On the doctor''s invite list');
  end if;

  select doctor_id, created_at into v_ref_doc, v_ref from public.family_package_referrals where account_id = p_account;
  if v_ref_doc is not null and v_ref_doc = p_doctor then
    select min(c.created_at) into v_first
    from public.consultations c
    join public.family_members fm on fm.id = c.patient_id
    where fm.account_id = p_account
      and not exists (select 1 from public.family_package_claims cl where cl.consultation_id = c.id);
    if v_first is null or v_ref <= v_first then
      return jsonb_build_object('source', 'doctor', 'reason', 'Came through the doctor''s referral link');
    end if;
    return jsonb_build_object('source', 'platform', 'reason', 'Booked on the platform before using the doctor''s link');
  end if;
  if v_ref_doc is not null then
    return jsonb_build_object('source', 'platform', 'reason', 'First touch was another doctor''s link');
  end if;
  return jsonb_build_object('source', 'platform', 'reason', 'Found the doctor on the platform');
end;
$$;

revoke all on function public.package_attribution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.package_attribution(uuid, uuid) to service_role;

-- 2. Begin a purchase (server only) --------------------------------------------
create or replace function public.package_begin_purchase(p_account uuid, p_package uuid, p_environment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
  pk public.family_packages%rowtype;
  v_live public.family_package_purchases%rowtype;
  v_attr jsonb;
  v_source text;
  v_pct int;
  v_doc_pkr int;
  v_new uuid;
begin
  select sales_open into v_open from public.family_package_settings where id;
  if not coalesce(v_open, false) then
    return jsonb_build_object('ok', false, 'error', 'Family packs are not on sale yet.');
  end if;
  select * into pk from public.family_packages where id = p_package;
  if not found or pk.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'This pack is not available right now.');
  end if;
  if not exists (select 1 from public.public_doctor_directory d where d.id = pk.doctor_id) then
    return jsonb_build_object('ok', false, 'error', 'This doctor is not taking new patients right now.');
  end if;
  if p_account is null or not exists (select 1 from auth.users where id = p_account) then
    return jsonb_build_object('ok', false, 'error', 'Please log in to buy a pack.');
  end if;
  if public.package_is_guest(p_account) then
    return jsonb_build_object('ok', false, 'error', 'Please create a free account first. A quick guest booking cannot hold a pack.');
  end if;
  if exists (select 1 from public.doctor_profiles where id = p_account) then
    return jsonb_build_object('ok', false, 'error', 'Doctor accounts cannot buy a pack.');
  end if;

  -- A family with a live pack and consultations left may renew only inside the
  -- renewal window of a pack that allows rollover. Otherwise they use what they have.
  select * into v_live
  from public.family_package_purchases
  where account_id = p_account and doctor_id = pk.doctor_id and status = 'active'
    and expires_at > now() and public.package_credits_left(id) > 0
  order by expires_at desc limit 1;
  if found then
    if not pk.rollover_enabled or v_live.expires_at > now() + make_interval(days => pk.rollover_window_days) then
      return jsonb_build_object('ok', false, 'error',
        'You already have a live pack with this doctor (' || public.package_credits_left(v_live.id) || ' consultations left). You can buy the next one when it is about to end.');
    end if;
  elsif pk.max_families is not null
        and public.package_active_families(pk.doctor_id) >= pk.max_families then
    return jsonb_build_object('ok', false, 'error', 'This doctor''s pack is full right now. Please check again soon.');
  end if;

  v_attr := public.package_attribution(p_account, pk.doctor_id);
  v_source := v_attr ->> 'source';
  v_pct := case v_source when 'doctor' then pk.doctor_share_own_pct else pk.doctor_share_platform_pct end;
  v_doc_pkr := floor(pk.price_pkr * v_pct / 100.0)::int;

  insert into public.family_package_purchases (
    package_id, doctor_id, account_id, price_pkr, members_allowed, consultations_total,
    allow_text, allow_audio, allow_video, audio_limit, video_limit, validity_days,
    rollover_enabled, rollover_cap, rollover_window_days, reply_window_hours,
    payment_method, gateway, gateway_environment, status,
    source, source_reason, doctor_share_pct, doctor_share_pkr, platform_share_pkr,
    share_own_pct, share_platform_pct
  ) values (
    pk.id, pk.doctor_id, p_account, pk.price_pkr, pk.members_allowed, pk.consultations_total,
    pk.allow_text, pk.allow_audio, pk.allow_video, pk.audio_limit, pk.video_limit, pk.validity_days,
    pk.rollover_enabled, pk.rollover_cap, pk.rollover_window_days, pk.reply_window_hours,
    'safepay', 'safepay', p_environment, 'pending',
    v_source, v_attr ->> 'reason', v_pct, v_doc_pkr, pk.price_pkr - v_doc_pkr,
    pk.doctor_share_own_pct, pk.doctor_share_platform_pct
  ) returning id into v_new;

  return jsonb_build_object('ok', true, 'purchase_id', v_new, 'amount_pkr', pk.price_pkr, 'doctor_id', pk.doctor_id);
end;
$$;

revoke all on function public.package_begin_purchase(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.package_begin_purchase(uuid, uuid, text) to service_role;

-- Remember the Safepay tracker on a pending purchase / drop a checkout that never opened.
create or replace function public.package_set_tracker(p_purchase uuid, p_tracker text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.family_package_purchases
  set gateway_tracker_token = p_tracker, updated_at = now()
  where id = p_purchase and status = 'pending';
$$;

create or replace function public.package_cancel_pending(p_purchase uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.family_package_purchases
  set status = 'cancelled', updated_at = now()
  where id = p_purchase and status = 'pending' and gateway_tracker_token is null;
$$;

revoke all on function public.package_set_tracker(uuid, text) from public, anon, authenticated;
revoke all on function public.package_cancel_pending(uuid) from public, anon, authenticated;
grant execute on function public.package_set_tracker(uuid, text) to service_role;
grant execute on function public.package_cancel_pending(uuid) to service_role;

-- 3. Settle a paid purchase (server only; safe to call twice) ------------------
create or replace function public.settle_package_purchase(p_purchase_id uuid, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu public.family_package_purchases%rowtype;
  v_prior public.family_package_purchases%rowtype;
  v_carry int := 0;
  v_exp timestamptz;
begin
  select * into pu from public.family_package_purchases where id = p_purchase_id for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'not_found');
  end if;
  if pu.status = 'active' then
    return jsonb_build_object('settled', false, 'reason', 'already_settled', 'expires_at', pu.expires_at);
  end if;
  if pu.status <> 'pending' then
    -- Paid after the checkout was dropped or the purchase was refunded: do not
    -- guess. The server logs this for the admin to look at.
    return jsonb_build_object('settled', false, 'reason', 'not_pending', 'status', pu.status);
  end if;

  if pu.rollover_enabled and pu.rollover_cap > 0 then
    select * into v_prior
    from public.family_package_purchases
    where account_id = pu.account_id and doctor_id = pu.doctor_id and id <> pu.id
      and status = 'active' and rolled_to is null
      and expires_at > now() - make_interval(days => pu.rollover_window_days)
      and expires_at <= now() + make_interval(days => pu.rollover_window_days)
    order by expires_at desc limit 1
    for update;
    if found then
      v_carry := least(public.package_credits_left(v_prior.id), pu.rollover_cap);
      update public.family_package_purchases
      set rolled_to = pu.id, expires_at = least(expires_at, now()), updated_at = now()
      where id = v_prior.id;
    end if;
  end if;

  v_exp := now() + make_interval(days => pu.validity_days);
  update public.family_package_purchases
  set status = 'active', paid_at = now(), starts_at = now(), expires_at = v_exp,
      rollover_credits = v_carry,
      raw_payload = coalesce(p_raw, raw_payload), updated_at = now()
  where id = pu.id;

  return jsonb_build_object('settled', true, 'expires_at', v_exp, 'rollover_credits', v_carry);
end;
$$;

revoke all on function public.settle_package_purchase(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.settle_package_purchase(uuid, jsonb) to service_role;

-- 4. Admin: change who brought the family ---------------------------------------
create or replace function public.admin_package_set_source(p_purchase_id uuid, p_source text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pu public.family_package_purchases%rowtype;
  pk public.family_packages%rowtype;
  v_pct int;
  v_net int;
  v_doc int;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_source not in ('doctor', 'platform') then
    raise exception 'Source must be doctor or platform.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please write a short reason.';
  end if;
  select * into pu from public.family_package_purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Purchase not found.';
  end if;
  select * into pk from public.family_packages where id = pu.package_id;
  v_pct := case p_source
             when 'doctor' then coalesce(pu.share_own_pct, pk.doctor_share_own_pct)
             else coalesce(pu.share_platform_pct, pk.doctor_share_platform_pct) end;
  v_net := pu.price_pkr - coalesce(pu.refund_pkr, 0);
  v_doc := floor(v_net * v_pct / 100.0)::int;
  update public.family_package_purchases
  set source = p_source,
      source_reason = 'Admin: ' || btrim(p_reason),
      source_set_by = auth.uid(),
      doctor_share_pct = v_pct,
      doctor_share_pkr = v_doc,
      platform_share_pkr = v_net - v_doc,
      updated_at = now()
  where id = pu.id;
end;
$$;

grant execute on function public.admin_package_set_source(uuid, text, text) to authenticated;

-- 5. Admin: what each doctor is owed -----------------------------------------------
create or replace function public.admin_package_payouts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.owed_pkr desc, d.doctor_name), '[]'::jsonb) into v_out
  from (
    select
      pu.doctor_id,
      dp.full_name as doctor_name,
      sum(pu.doctor_share_pkr)::int as earned_pkr,
      sum(coalesce(pu.doctor_paid_pkr, case when pu.doctor_paid_at is not null then pu.doctor_share_pkr else 0 end))::int as paid_pkr,
      (sum(pu.doctor_share_pkr) - sum(coalesce(pu.doctor_paid_pkr, case when pu.doctor_paid_at is not null then pu.doctor_share_pkr else 0 end)))::int as owed_pkr,
      count(*)::int as packs,
      jsonb_agg(jsonb_build_object(
        'id', pu.id, 'created_at', pu.created_at, 'status', pu.status, 'payment_method', pu.payment_method,
        'price_pkr', pu.price_pkr, 'refund_pkr', pu.refund_pkr,
        'source', pu.source, 'source_reason', pu.source_reason, 'share_pct', pu.doctor_share_pct,
        'share_pkr', pu.doctor_share_pkr,
        'paid_pkr', coalesce(pu.doctor_paid_pkr, case when pu.doctor_paid_at is not null then pu.doctor_share_pkr else 0 end),
        'owed_pkr', pu.doctor_share_pkr - coalesce(pu.doctor_paid_pkr, case when pu.doctor_paid_at is not null then pu.doctor_share_pkr else 0 end),
        'family', coalesce((select fm.full_name from public.family_members fm where fm.account_id = pu.account_id and fm.archived_at is null order by fm.created_at limit 1), 'Family'),
        'email', (select u.email from auth.users u where u.id = pu.account_id),
        'credits_left', public.package_credits_left(pu.id),
        'credits_total', pu.consultations_total + pu.rollover_credits,
        'expires_at', pu.expires_at
      ) order by pu.created_at desc) as lines
    from public.family_package_purchases pu
    join public.doctor_profiles dp on dp.id = pu.doctor_id
    where pu.status in ('active', 'refunded')
    group by pu.doctor_id, dp.full_name
  ) d;
  return v_out;
end;
$$;

grant execute on function public.admin_package_payouts() to authenticated;

-- Record that you paid a doctor. p_expected_net_pkr is the amount the screen showed;
-- if anything changed since (a refund, another sale) the call stops so nothing is
-- marked paid by mistake. Lines that were refunded after being paid make the net
-- smaller (a deduction); they are settled together.
create or replace function public.admin_package_mark_paid(p_doctor_id uuid, p_expected_net_pkr int, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net int;
  v_n int;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select coalesce(sum(doctor_share_pkr - coalesce(doctor_paid_pkr, case when doctor_paid_at is not null then doctor_share_pkr else 0 end)), 0)::int
    into v_net
  from public.family_package_purchases
  where doctor_id = p_doctor_id and status in ('active', 'refunded');
  if v_net is distinct from p_expected_net_pkr then
    raise exception 'The amount owed changed (now PKR %). Please refresh and check it again.', v_net;
  end if;
  if v_net = 0 then
    raise exception 'Nothing is owed to this doctor.';
  end if;
  update public.family_package_purchases
  set doctor_paid_pkr = doctor_share_pkr,
      doctor_paid_at = now(),
      doctor_paid_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where doctor_id = p_doctor_id and status in ('active', 'refunded')
    and doctor_share_pkr is distinct from coalesce(doctor_paid_pkr, case when doctor_paid_at is not null then doctor_share_pkr else 0 end);
  get diagnostics v_n = row_count;
  return jsonb_build_object('net_pkr', v_net, 'lines', v_n);
end;
$$;

grant execute on function public.admin_package_mark_paid(uuid, int, text) to authenticated;

-- 6. Admin: refund record ------------------------------------------------------------
-- What to give back for the unused part of a pack (shown on the screen as a
-- suggestion; the admin can type any amount).
create or replace function public.admin_package_refund_suggestion(p_purchase_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pu public.family_package_purchases%rowtype;
  v_total int;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select * into pu from public.family_package_purchases where id = p_purchase_id;
  if not found then
    raise exception 'Purchase not found.';
  end if;
  v_total := pu.consultations_total + pu.rollover_credits;
  if v_total <= 0 then
    return 0;
  end if;
  return floor(pu.price_pkr * least(public.package_credits_left(pu.id), pu.consultations_total)::numeric / pu.consultations_total)::int;
end;
$$;

grant execute on function public.admin_package_refund_suggestion(uuid) to authenticated;

create or replace function public.admin_package_refund(p_purchase_id uuid, p_refund_pkr int, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pu public.family_package_purchases%rowtype;
  v_net int;
  v_doc int;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select * into pu from public.family_package_purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Purchase not found.';
  end if;
  if pu.status <> 'active' then
    raise exception 'Only a live pack can be refunded.';
  end if;
  if p_refund_pkr is null or p_refund_pkr < 0 or p_refund_pkr > pu.price_pkr then
    raise exception 'The refund must be between 0 and PKR %.', pu.price_pkr;
  end if;
  v_net := pu.price_pkr - p_refund_pkr;
  v_doc := floor(v_net * pu.doctor_share_pct / 100.0)::int;
  update public.family_package_purchases
  set status = 'refunded', refunded_at = now(), refund_pkr = p_refund_pkr,
      refund_note = nullif(btrim(coalesce(p_note, '')), ''),
      expires_at = least(expires_at, now()),
      doctor_share_pkr = v_doc, platform_share_pkr = v_net - v_doc,
      updated_at = now()
  where id = pu.id;
end;
$$;

grant execute on function public.admin_package_refund(uuid, int, text) to authenticated;
