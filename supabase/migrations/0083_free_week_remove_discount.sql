-- 0083: remove the post-free-week discount (2026-10-20).
--
-- Zayn decided there is no discount after the free week. 0081 (as shipped in
-- the current free-week zip) no longer contains any discount objects, so on a
-- database where the CURRENT 0081 has been run this file changes nothing
-- important (it only re-asserts the same three functions).
--
-- If an EARLIER copy of 0081 (the one with the PKR 250 discount) was already
-- run, this file removes everything that belonged to the discount:
--   * the discount functions and the discount bookkeeping table,
--   * the two discount columns on free_week_campaigns,
--   * and re-creates free_week_status / admin_free_week_save /
--     admin_free_week_report without any discount fields.
-- Free consultations, registrations and bookings already made are not touched.
-- Safe to run more than once. Run it AFTER 0081.

drop function if exists public.free_week_consume_discount(uuid);
drop function if exists public.free_week_apply_discount(uuid, uuid, int);
drop function if exists public.free_week_my_discount();
drop function if exists public.free_week_discount_available(uuid);
drop function if exists public.admin_free_week_save(text, date, date, date, boolean, int, int, int, int);

create or replace function public.free_week_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_member public.free_week_members;
  v_used int := 0;
  v_phone text;
begin
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase in ('none', 'draft') then
    return jsonb_build_object('phase', 'none');
  end if;

  if v_me is not null then
    select * into v_member from public.free_week_members
     where campaign_id = c.id and account_id = v_me;
    v_used := public.free_week_credits_used(c.id, v_me);
    select pp.phone into v_phone from public.patient_profiles pp where pp.id = v_me;
  end if;

  return jsonb_build_object(
    'phase', v_phase,
    'name', c.name,
    'opens_on', c.opens_on,
    'starts_on', c.starts_on,
    'ends_on', c.ends_on,
    'credits_per_account', c.credits_per_account,
    'modes', to_jsonb(c.modes),
    'signed_in', v_me is not null,
    'is_guest', case when v_me is null then false else public.free_week_is_guest(v_me) end,
    'enrolled', v_member.account_id is not null,
    'credits_used', v_used,
    'credits_left', greatest(c.credits_per_account - v_used, 0),
    'phone_on_file', v_phone
  );
end;
$$;

grant execute on function public.free_week_status() to anon, authenticated;

create or replace function public.admin_free_week_save(
  p_name text,
  p_opens_on date,
  p_starts_on date,
  p_ends_on date,
  p_active boolean,
  p_credits int,
  p_overall_cap int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select id into v_id from public.free_week_campaigns order by created_at desc limit 1;
  if v_id is null then
    insert into public.free_week_campaigns
      (name, opens_on, starts_on, ends_on, active, credits_per_account, overall_cap)
    values (coalesce(nullif(btrim(p_name), ''), 'Free Family Consultation Week'),
            p_opens_on, p_starts_on, p_ends_on, coalesce(p_active, false),
            coalesce(p_credits, 3), p_overall_cap)
    returning id into v_id;
  else
    update public.free_week_campaigns
       set name = coalesce(nullif(btrim(p_name), ''), name),
           opens_on = p_opens_on, starts_on = p_starts_on, ends_on = p_ends_on,
           active = coalesce(p_active, false),
           credits_per_account = coalesce(p_credits, credits_per_account),
           overall_cap = p_overall_cap
     where id = v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function public.admin_free_week_save(text, date, date, date, boolean, int, int) to authenticated;

create or replace function public.admin_free_week_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  r jsonb;
  v_doctors jsonb;
  v_has_ratings boolean := to_regclass('public.doctor_rating_summary') is not null;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select * into c from public.free_week_campaigns order by created_at desc limit 1;
  if c.id is null then
    return jsonb_build_object('exists', false);
  end if;

  r := jsonb_build_object(
    'exists', true,
    'phase', public.free_week_phase(c),
    'families_registered', (select count(*) from public.free_week_members where campaign_id = c.id),
    'families_consenting', (select count(*) from public.free_week_members where campaign_id = c.id and marketing_consent),
    'families_booked', (select count(distinct account_id) from public.free_week_claims fc
                          join public.consultations co on co.id = fc.consultation_id
                         where fc.campaign_id = c.id and co.status <> 'cancelled'),
    'visits_booked', (select count(*) from public.free_week_claims fc
                        join public.consultations co on co.id = fc.consultation_id
                       where fc.campaign_id = c.id and co.status <> 'cancelled'),
    'visits_completed', (select count(*) from public.free_week_claims fc
                           join public.consultations co on co.id = fc.consultation_id
                          where fc.campaign_id = c.id and co.status = 'completed'),
    'visits_cancelled', (select count(*) from public.free_week_claims fc
                           join public.consultations co on co.id = fc.consultation_id
                          where fc.campaign_id = c.id and co.status = 'cancelled'),
    'visits_text', (select count(*) from public.free_week_claims fc
                      join public.consultations co on co.id = fc.consultation_id
                     where fc.campaign_id = c.id and co.status <> 'cancelled' and fc.delivery_mode = 'text'),
    'visits_audio', (select count(*) from public.free_week_claims fc
                       join public.consultations co on co.id = fc.consultation_id
                      where fc.campaign_id = c.id and co.status <> 'cancelled' and fc.delivery_mode = 'audio'),
    'doctors_opted_in', (select count(*) from public.free_week_doctors where campaign_id = c.id and opted_in),
    -- Families that had a completed free visit and later paid for a normal one.
    'families_completed_free', (select count(distinct fc.account_id) from public.free_week_claims fc
                                  join public.consultations co on co.id = fc.consultation_id
                                 where fc.campaign_id = c.id and co.status = 'completed'),
    'families_paid_after', (
      select count(distinct fc.account_id)
      from public.free_week_claims fc
      join public.consultations co on co.id = fc.consultation_id and co.status = 'completed'
      join public.payments p on p.account_id = fc.account_id and p.status = 'succeeded'
       and coalesce(p.gateway_environment, 'production') = 'production'
       and p.created_at >= c.starts_on::timestamp at time zone 'Asia/Karachi'
      where fc.campaign_id = c.id
        and not exists (select 1 from public.free_week_claims f2 where f2.consultation_id = p.consultation_id)
    ),
    'paid_revenue_pkr', coalesce((
      select sum(p.amount)
      from public.payments p
      where p.status = 'succeeded' and coalesce(p.gateway_environment, 'production') = 'production'
        and p.created_at >= c.starts_on::timestamp at time zone 'Asia/Karachi'
        and p.account_id in (select account_id from public.free_week_members where campaign_id = c.id)
        and not exists (select 1 from public.free_week_claims f2 where f2.consultation_id = p.consultation_id)
    ), 0)
  );

  v_doctors := coalesce((
    select jsonb_agg(row_to_json(t) order by t.visits desc, t.full_name)
    from (
      select dp.id as doctor_id,
             dp.full_name,
             fd.opted_in,
             fd.daily_free_cap,
             (select count(*) from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
               where fc.campaign_id = c.id and fc.doctor_id = dp.id and co.status <> 'cancelled') as visits,
             (select count(*) from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
               where fc.campaign_id = c.id and fc.doctor_id = dp.id and co.status = 'completed') as completed,
             (select count(*) from public.free_week_slots fs join public.doctor_availability_slots s on s.id = fs.slot_id
               where fs.campaign_id = c.id and s.doctor_id = dp.id) as free_slots
      from public.free_week_doctors fd
      join public.doctor_profiles dp on dp.id = fd.doctor_id
      where fd.campaign_id = c.id
    ) t
  ), '[]'::jsonb);

  -- Add star ratings if the ratings migration (0080) has been run.
  if v_has_ratings then
    v_doctors := coalesce((
      select jsonb_agg(
        d || jsonb_build_object('avg_rating', rs.avg_rating, 'review_count', rs.review_count)
        order by (d ->> 'visits')::int desc, d ->> 'full_name')
      from jsonb_array_elements(v_doctors) d
      left join public.doctor_rating_summary rs on rs.doctor_id = (d ->> 'doctor_id')::uuid
    ), '[]'::jsonb);
  end if;

  return r || jsonb_build_object('doctors', v_doctors);
end;
$$;

grant execute on function public.admin_free_week_report() to authenticated;

drop table if exists public.free_week_discount_uses;
alter table public.free_week_campaigns drop column if exists discount_pkr;
alter table public.free_week_campaigns drop column if exists discount_days;
