-- Family packages, part 2 of 4: using a pack (2026-10-26).
--   * package_start_consultation: the patient's one-tap start. Creates a
--     normal consultation (status 'submitted', no payment row, exactly like
--     a free follow-up voucher or a free-week visit) and uses one credit.
--   * Text, voice-note, audio and video all go through the SAME consultation
--     screens, prescriptions and "End consultation" as today.
--   * Package consultations are exempt from the doctor's text hours, text
--     off-days and daily patient cap (decided 2026-10-26: a paid patient can
--     always leave a message; the doctor replies in working hours). The
--     protection for the doctor is "max families" on the package. Audio and
--     video still need a free slot (slot capacity is NOT bypassed).
--   * What the patient and the doctor see (package_my_purchases,
--     doctor_package_my_state), an admin "grant a pack by hand" for pilots,
--     and "return a credit".
--
-- Requires 0088. ROLLBACK: ROLLBACK-0089.sql (also restores the three
-- original trigger functions word for word).

-- 1. The three booking rules learn one exemption ---------------------------
-- Each function below is the live version (0032 / 0033 / 0062) with ONE
-- added line at the top: skip when this transaction is a package start.
-- The marker is set only inside package_start_consultation (a security
-- definer function) and cleared straight after, the same way the free week
-- marks its own insert. Nobody can set it from the browser.

create or replace function public.enforce_text_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start time;
  v_end time;
  v_limit int;
  v_now_pkt timestamp;
  v_today_count int;
  v_has_row boolean;
begin
  if coalesce(current_setting('app.package_claim', true), '') = '1' then
    return new;
  end if;
  if new.delivery_mode <> 'text' then
    return new;
  end if;

  select dta.start_time, dta.end_time, dta.daily_limit
    into v_start, v_end, v_limit
  from public.doctor_text_availability dta
  where dta.doctor_id = new.doctor_id
  for update;

  v_has_row := found;
  v_now_pkt := (now() at time zone 'Asia/Karachi');

  if not v_has_row then
    -- No doctor-specific window — the platform's own standard hours
    -- apply (8:00 AM-11:00 PM Pakistan time), with no daily cap.
    v_start := time '08:00';
    v_end := time '23:00';
  end if;

  if not (v_now_pkt::time >= v_start and v_now_pkt::time < v_end) then
    raise exception
      'This doctor is only available for text consultations between % and % (Pakistan time). Please try again during those hours, choose audio/video, or pick a different doctor.',
      to_char(v_start, 'HH12:MI AM'), to_char(v_end, 'HH12:MI AM');
  end if;

  if v_has_row then
    select count(*) into v_today_count
    from public.consultations c
    where c.doctor_id = new.doctor_id
      and c.delivery_mode = 'text'
      and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

    if v_today_count >= v_limit then
      raise exception
        'This doctor has reached their text consultation limit for today. Please try again tomorrow, choose audio/video, or pick a different doctor.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_daily_patient_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_now_pkt timestamp;
  v_today_count int;
begin
  if coalesce(current_setting('app.package_claim', true), '') = '1' then
    return new;
  end if;
  select daily_patient_cap into v_cap
  from public.doctor_profiles
  where id = new.doctor_id
  for update;

  if v_cap is null then
    -- No doctor_profiles row for this doctor_id at all — shouldn't be
    -- reachable (assign_default_doctor already validates doctor_id
    -- against a live doctor_profiles row before this trigger runs),
    -- but fail open rather than block on a state that can't sensibly
    -- be capped.
    return new;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = new.doctor_id
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  if v_today_count >= v_cap then
    raise exception
      'This doctor has reached their maximum of % patients for today across all consultation types. Please try again tomorrow or choose a different doctor.',
      v_cap;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_text_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.package_claim', true), '') = '1' then
    return new;
  end if;
  if new.delivery_mode = 'text'
     and new.doctor_id is not null
     and public.text_is_switched_off(new.doctor_id, (now() at time zone 'Asia/Karachi')) then
    raise exception
      'This doctor is not taking text consultations today. Please try another day, choose audio/video, or pick a different doctor.';
  end if;
  return new;
end;
$$;

-- 2. How many of one mode a purchase has used --------------------------------
create or replace function public.package_mode_used(p_purchase uuid, p_mode text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.family_package_claims cl
  join public.consultations co on co.id = cl.consultation_id
  where cl.purchase_id = p_purchase and cl.state = 'used' and co.status <> 'cancelled'
    and cl.delivery_mode = p_mode;
$$;

-- 3. The one-tap start ---------------------------------------------------------
create or replace function public.package_start_consultation(
  p_purchase_id uuid,
  p_member_id uuid,
  p_mode text,
  p_complaint text,
  p_slot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  pu public.family_package_purchases%rowtype;
  v_complaint text := btrim(coalesce(p_complaint, ''));
  v_left int;
  v_used_mode int;
  v_places int;
  v_start timestamptz;
  v_new uuid;
begin
  if v_me is null then
    raise exception 'Please log in to start a consultation.';
  end if;
  if p_mode is null or p_mode not in ('text', 'audio', 'video') then
    raise exception 'Please choose text, audio or video.';
  end if;
  if v_complaint = '' then
    raise exception 'Please tell the doctor briefly what the problem is.';
  end if;
  if length(v_complaint) > 1000 then
    raise exception 'Please keep the problem to 1,000 characters or fewer. You can add more detail in the chat.';
  end if;

  select * into pu from public.family_package_purchases where id = p_purchase_id for update;
  if not found or pu.account_id <> v_me then
    raise exception 'That pack was not found on your account.';
  end if;
  if pu.status = 'pending' then
    raise exception 'The payment for this pack has not been completed yet.';
  elsif pu.status = 'refunded' or pu.status = 'cancelled' then
    raise exception 'This pack is no longer active.';
  end if;
  if pu.expires_at is null or pu.expires_at <= now() then
    raise exception 'This pack has ended. You can buy a new one from the doctor''s page.';
  end if;

  if not exists (
    select 1 from public.family_members
    where id = p_member_id and account_id = v_me and archived_at is null
  ) then
    raise exception 'You can only use the pack for people in your own account.';
  end if;

  if (p_mode = 'text' and not pu.allow_text)
     or (p_mode = 'audio' and not pu.allow_audio)
     or (p_mode = 'video' and not pu.allow_video) then
    raise exception 'This pack does not include %.', case p_mode when 'text' then 'text consultations' when 'audio' then 'audio calls' else 'video calls' end;
  end if;

  if not exists (select 1 from public.public_doctor_directory d where d.id = pu.doctor_id) then
    raise exception 'This doctor is not taking consultations right now. Please contact Family Medic and we will sort it out.';
  end if;

  v_left := public.package_credits_left(pu.id);
  if v_left <= 0 then
    raise exception 'You have used all the consultations in this pack.';
  end if;
  if p_mode = 'audio' and pu.audio_limit is not null then
    v_used_mode := public.package_mode_used(pu.id, 'audio');
    if v_used_mode >= pu.audio_limit then
      raise exception 'This pack includes % audio call(s) and they have all been used.', pu.audio_limit;
    end if;
  end if;
  if p_mode = 'video' and pu.video_limit is not null then
    v_used_mode := public.package_mode_used(pu.id, 'video');
    if v_used_mode >= pu.video_limit then
      raise exception 'This pack includes % video call(s) and they have all been used.', pu.video_limit;
    end if;
  end if;

  if p_mode = 'text' then
    if p_slot_id is not null then
      raise exception 'Text consultations do not use a time slot.';
    end if;
  else
    if p_slot_id is null then
      raise exception 'Please choose a time for the call.';
    end if;
    select s.start_time into v_start
    from public.doctor_availability_slots s
    where s.id = p_slot_id and s.doctor_id = pu.doctor_id;
    if v_start is null or v_start <= now() then
      raise exception 'That time is no longer available. Please choose another.';
    end if;
  end if;

  -- A family profile takes one of the pack's places the first time it is used.
  if not exists (
    select 1 from public.family_package_members where purchase_id = pu.id and family_member_id = p_member_id
  ) then
    select count(*)::int into v_places from public.family_package_members where purchase_id = pu.id;
    if v_places >= pu.members_allowed then
      raise exception 'This pack covers % people and all places are taken.', pu.members_allowed;
    end if;
    insert into public.family_package_members (purchase_id, family_member_id) values (pu.id, p_member_id);
  end if;

  perform set_config('app.package_claim', '1', true);
  insert into public.consultations (patient_id, doctor_id, complaint, delivery_mode, slot_id, status)
  values (p_member_id, pu.doctor_id, v_complaint, p_mode,
          case when p_mode = 'text' then null else p_slot_id end, 'submitted')
  returning id into v_new;
  perform set_config('app.package_claim', '', true);

  insert into public.family_package_claims (purchase_id, consultation_id, family_member_id, doctor_id, delivery_mode)
  values (pu.id, v_new, p_member_id, pu.doctor_id, p_mode);

  return v_new;
end;
$$;

grant execute on function public.package_start_consultation(uuid, uuid, text, text, uuid) to authenticated;

-- 4. What a patient sees -----------------------------------------------------
-- Packs on the signed-in account that are live, or ended within the last 30
-- days (so a family can see what happened).
create or replace function public.package_my_purchases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_out jsonb;
begin
  if v_me is null then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_out
  from (
    select
      pu.id, pu.created_at, pu.status, pu.expires_at, pu.starts_at, pu.price_pkr,
      pu.members_allowed, pu.consultations_total, pu.rollover_credits,
      pu.allow_text, pu.allow_audio, pu.allow_video, pu.audio_limit, pu.video_limit,
      pu.reply_window_hours,
      public.package_credits_left(pu.id) as credits_left,
      public.package_mode_used(pu.id, 'audio') as audio_used,
      public.package_mode_used(pu.id, 'video') as video_used,
      (pu.status = 'active' and pu.expires_at > now()) as is_live,
      jsonb_build_object(
        'id', d.id, 'name', d.full_name, 'specialty', d.specialty,
        'photo', (select dd.profile_photo_url from public.public_doctor_directory dd where dd.id = d.id),
        'available', exists (select 1 from public.public_doctor_directory dd where dd.id = d.id)
      ) as doctor,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', fm.id, 'name', fm.full_name) order by m.created_at)
        from public.family_package_members m
        join public.family_members fm on fm.id = m.family_member_id
        where m.purchase_id = pu.id
      ), '[]'::jsonb) as members_used,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'consultation_id', co.id, 'mode', cl.delivery_mode, 'status', co.status,
                 'member', fm.full_name, 'created_at', co.created_at
               ) order by co.created_at desc)
        from public.family_package_claims cl
        join public.consultations co on co.id = cl.consultation_id
        join public.family_members fm on fm.id = cl.family_member_id
        where cl.purchase_id = pu.id and cl.state = 'used' and co.status <> 'cancelled'
      ), '[]'::jsonb) as consultations
    from public.family_package_purchases pu
    join public.doctor_profiles d on d.id = pu.doctor_id
    where pu.account_id = v_me
      and pu.status = 'active'
      and (pu.expires_at > now() or pu.expires_at > now() - interval '30 days')
  ) x;
  return v_out;
end;
$$;

grant execute on function public.package_my_purchases() to authenticated;

-- 5. What a doctor sees -------------------------------------------------------
create or replace function public.doctor_package_my_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  pk public.family_packages%rowtype;
  rq record;
  v_open boolean;
  v_fams jsonb;
  v_earned int;
  v_paid int;
  v_need int;
  v_over int;
  v_month int;
  v_code text;
  v_invites int;
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    raise exception 'Doctors only.';
  end if;
  select sales_open into v_open from public.family_package_settings where id;
  select * into pk from public.family_packages where doctor_id = v_me and status in ('active', 'paused');
  select * into rq from public.family_package_requests
   where doctor_id = v_me and (status = 'pending' or decided_at > now() - interval '30 days')
   order by created_at desc limit 1;

  select coalesce(jsonb_agg(f order by f.needs_reply desc, f.expires_at), '[]'::jsonb) into v_fams
  from (
    select
      pu.id as purchase_id,
      pu.status, pu.expires_at, pu.created_at, pu.source, pu.doctor_share_pkr, pu.price_pkr,
      pu.consultations_total + pu.rollover_credits as credits_total,
      public.package_credits_left(pu.id) as credits_left,
      coalesce(
        (select fm.full_name from public.family_members fm where fm.account_id = pu.account_id and fm.relationship = 'self' and fm.archived_at is null order by fm.created_at limit 1),
        (select fm.full_name from public.family_members fm where fm.account_id = pu.account_id and fm.archived_at is null order by fm.created_at limit 1),
        'Family'
      ) as family_name,
      coalesce((
        select jsonb_agg(fm.full_name order by m.created_at)
        from public.family_package_members m join public.family_members fm on fm.id = m.family_member_id
        where m.purchase_id = pu.id
      ), '[]'::jsonb) as members,
      (select count(*)::int from public.family_package_claims cl
         join public.consultations co on co.id = cl.consultation_id
        where cl.purchase_id = pu.id and cl.state = 'used' and co.delivery_mode = 'text' and co.status = 'submitted'
          and coalesce((select m.sender_role from public.consultation_messages m where m.consultation_id = co.id order by m.created_at desc limit 1), 'patient') = 'patient'
      ) as needs_reply,
      (select count(*)::int from public.family_package_claims cl
         join public.consultations co on co.id = cl.consultation_id
        where cl.purchase_id = pu.id and cl.state = 'used' and co.delivery_mode = 'text' and co.status = 'submitted'
          and coalesce((select m.sender_role from public.consultation_messages m where m.consultation_id = co.id order by m.created_at desc limit 1), 'patient') = 'patient'
          and coalesce((select m.created_at from public.consultation_messages m where m.consultation_id = co.id and m.sender_role = 'patient' order by m.created_at desc limit 1), co.created_at)
              < now() - make_interval(hours => pu.reply_window_hours)
      ) as overdue,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'consultation_id', co.id, 'member', fm.full_name, 'mode', cl.delivery_mode, 'status', co.status,
                 'created_at', co.created_at,
                 'needs_reply', (co.delivery_mode = 'text' and co.status = 'submitted'
                    and coalesce((select m.sender_role from public.consultation_messages m where m.consultation_id = co.id order by m.created_at desc limit 1), 'patient') = 'patient')
               ) order by co.created_at desc)
        from (select * from public.family_package_claims where purchase_id = pu.id and state = 'used' order by created_at desc limit 6) cl
        join public.consultations co on co.id = cl.consultation_id
        join public.family_members fm on fm.id = cl.family_member_id
        where co.status <> 'cancelled'
      ), '[]'::jsonb) as threads
    from public.family_package_purchases pu
    where pu.doctor_id = v_me and pu.status = 'active' and pu.expires_at > now() - interval '30 days'
  ) f;

  select coalesce(sum(doctor_share_pkr), 0)::int,
         coalesce(sum(coalesce(doctor_paid_pkr, case when doctor_paid_at is not null then doctor_share_pkr else 0 end)), 0)::int
    into v_earned, v_paid
  from public.family_package_purchases where doctor_id = v_me and status in ('active', 'refunded');

  select coalesce(sum((f ->> 'needs_reply')::int), 0)::int, coalesce(sum((f ->> 'overdue')::int), 0)::int
    into v_need, v_over
  from jsonb_array_elements(v_fams) f
  where f ->> 'status' = 'active' and (f ->> 'expires_at')::timestamptz > now() - interval '30 days';

  select count(*)::int into v_month
  from public.family_package_claims cl join public.consultations co on co.id = cl.consultation_id
  where cl.doctor_id = v_me and cl.state = 'used' and co.status <> 'cancelled'
    and cl.created_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi';

  select code into v_code from public.family_package_ref_codes where doctor_id = v_me;
  select count(*)::int into v_invites from public.family_package_invites where doctor_id = v_me;

  return jsonb_build_object(
    'sales_open', coalesce(v_open, false),
    'package', case when pk.id is null then null else to_jsonb(pk) end,
    'request', case when rq.id is null then null else to_jsonb(rq) end,
    'active_families', public.package_active_families(v_me),
    'families', v_fams,
    'needs_reply', v_need,
    'overdue', v_over,
    'used_this_month', v_month,
    'earned_pkr', v_earned,
    'paid_out_pkr', v_paid,
    'owed_pkr', v_earned - v_paid,
    'ref_code', v_code,
    'invite_count', v_invites
  );
end;
$$;

grant execute on function public.doctor_package_my_state() to authenticated;

-- The doctor's own invite list (numbers only, no names).
create or replace function public.doctor_package_invite_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone_norm', phone_norm, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  from public.family_package_invites where doctor_id = auth.uid();
$$;

grant execute on function public.doctor_package_invite_list() to authenticated;

-- 6. Admin ----------------------------------------------------------------------

-- Put a pack on a family's account by hand (e.g. a pilot paid outside the
-- site). p_doctor_share_pct overrides the package's share; p_doctor_collected
-- = true marks the doctor as already holding the money (nothing is owed).
create or replace function public.admin_package_grant(
  p_package_id uuid,
  p_email text,
  p_source text default 'doctor',
  p_doctor_share_pct int default null,
  p_doctor_collected boolean default false,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pk public.family_packages%rowtype;
  v_acc uuid;
  v_pct int;
  v_doc_pkr int;
  v_new uuid;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select * into pk from public.family_packages where id = p_package_id;
  if not found or pk.status = 'archived' then
    raise exception 'That package is not available.';
  end if;
  if p_source not in ('doctor', 'platform') then
    raise exception 'Source must be doctor or platform.';
  end if;
  select id into v_acc from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_acc is null then
    raise exception 'No account has that email address.';
  end if;
  if public.package_is_guest(v_acc) or exists (select 1 from public.doctor_profiles where id = v_acc) then
    raise exception 'A pack can only be given to a registered patient account.';
  end if;
  if exists (
    select 1 from public.family_package_purchases
    where account_id = v_acc and doctor_id = pk.doctor_id and status = 'active' and expires_at > now()
      and public.package_credits_left(id) > 0
  ) then
    raise exception 'This family already has a live pack with this doctor.';
  end if;
  v_pct := coalesce(p_doctor_share_pct, case when p_source = 'doctor' then pk.doctor_share_own_pct else pk.doctor_share_platform_pct end);
  if v_pct < 0 or v_pct > 100 then
    raise exception 'The doctor''s share must be between 0 and 100.';
  end if;
  v_doc_pkr := floor(pk.price_pkr * v_pct / 100.0)::int;

  insert into public.family_package_purchases (
    package_id, doctor_id, account_id, price_pkr, members_allowed, consultations_total,
    allow_text, allow_audio, allow_video, audio_limit, video_limit, validity_days,
    rollover_enabled, rollover_cap, rollover_window_days, reply_window_hours,
    payment_method, status, paid_at, starts_at, expires_at,
    source, source_reason, source_set_by, doctor_share_pct, doctor_share_pkr, platform_share_pkr,
    doctor_paid_at, doctor_paid_pkr, doctor_paid_note, note, share_own_pct, share_platform_pct
  ) values (
    pk.id, pk.doctor_id, v_acc, pk.price_pkr, pk.members_allowed, pk.consultations_total,
    pk.allow_text, pk.allow_audio, pk.allow_video, pk.audio_limit, pk.video_limit, pk.validity_days,
    pk.rollover_enabled, pk.rollover_cap, pk.rollover_window_days, pk.reply_window_hours,
    'manual', 'active', now(), now(), now() + make_interval(days => pk.validity_days),
    p_source, 'Given by admin', auth.uid(), v_pct, v_doc_pkr, pk.price_pkr - v_doc_pkr,
    case when p_doctor_collected then now() end,
    case when p_doctor_collected then v_doc_pkr end,
    case when p_doctor_collected then 'Doctor collected the payment directly' end,
    nullif(btrim(coalesce(p_note, '')), ''), pk.doctor_share_own_pct, pk.doctor_share_platform_pct
  ) returning id into v_new;
  return v_new;
end;
$$;

grant execute on function public.admin_package_grant(uuid, text, text, int, boolean, text) to authenticated;

create or replace function public.admin_package_return_credit(p_claim_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  update public.family_package_claims
  set state = 'returned', returned_at = now(), returned_by = auth.uid(),
      return_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_claim_id and state = 'used';
  if not found then
    raise exception 'That credit was already returned or does not exist.';
  end if;
end;
$$;

grant execute on function public.admin_package_return_credit(uuid, text) to authenticated;

-- Recent purchases and text threads still waiting for a doctor reply past
-- the package's reply window (the "reminder" list for the admin).
create or replace function public.admin_package_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_buy jsonb;
  v_over jsonb;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_buy
  from (
    select pu.id, pu.created_at, pu.status, pu.payment_method, pu.price_pkr, pu.expires_at,
           pu.source, pu.source_reason, pu.doctor_share_pct, pu.doctor_share_pkr, pu.platform_share_pkr,
           pu.doctor_paid_at, d.full_name as doctor_name,
           coalesce((select fm.full_name from public.family_members fm where fm.account_id = pu.account_id and fm.archived_at is null order by fm.created_at limit 1), 'Family') as family_name,
           (select u.email from auth.users u where u.id = pu.account_id) as email,
           public.package_credits_left(pu.id) as credits_left,
           pu.consultations_total + pu.rollover_credits as credits_total
    from public.family_package_purchases pu
    join public.doctor_profiles d on d.id = pu.doctor_id
    where pu.created_at > now() - interval '90 days'
    order by pu.created_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(row_to_json(y)::jsonb order by y.waiting_since), '[]'::jsonb) into v_over
  from (
    select co.id as consultation_id, cl.id as claim_id, d.full_name as doctor_name, fm.full_name as member_name,
           pu.reply_window_hours,
           coalesce((select m.created_at from public.consultation_messages m where m.consultation_id = co.id and m.sender_role = 'patient' order by m.created_at desc limit 1), co.created_at) as waiting_since
    from public.family_package_claims cl
    join public.consultations co on co.id = cl.consultation_id
    join public.family_package_purchases pu on pu.id = cl.purchase_id
    join public.doctor_profiles d on d.id = cl.doctor_id
    join public.family_members fm on fm.id = cl.family_member_id
    where cl.state = 'used' and co.delivery_mode = 'text' and co.status = 'submitted'
      and coalesce((select m.sender_role from public.consultation_messages m where m.consultation_id = co.id order by m.created_at desc limit 1), 'patient') = 'patient'
      and coalesce((select m.created_at from public.consultation_messages m where m.consultation_id = co.id and m.sender_role = 'patient' order by m.created_at desc limit 1), co.created_at)
          < now() - make_interval(hours => pu.reply_window_hours)
  ) y;

  return jsonb_build_object('purchases', v_buy, 'overdue', v_over);
end;
$$;

grant execute on function public.admin_package_activity() to authenticated;
