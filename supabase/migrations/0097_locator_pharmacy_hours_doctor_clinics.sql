-- 0097: Locator, pharmacies as their own tab, opening hours, doctors add their own clinic
-- (2026-11-10). Run AFTER 0095 and 0096.
--
-- What this adds:
--   * A fourth tab: category 'pharmacy'. Existing pharmacy listings move over automatically.
--     (Labs stay under Doctors & Clinics for now.)
--   * Opening hours on every place: locator_places.hours (jsonb), checked by locator_hours_ok().
--       {"always": true}                          = open 24 hours
--       {"days": {"mon": [["09:00","13:00"],["17:00","21:00"]], "tue": [...]}}   (missing day = closed)
--   * Registered Family Medic doctors add / edit / remove their own clinic from the doctor
--     dashboard. Rules (all checked in the database, not in the screen):
--       - must be an approved, active doctor with paid access (subscription_status 'active');
--       - type 'clinic', source 'doctor', linked to the doctor (Book online), up to 10 per doctor;
--       - ONE clinic per doctor is covered by the PKR 2,500 access fee: it goes live at once and
--         is FREE until 12 months after the doctor's FIRST clinic listing, then pays the annual
--         fee (Admin > Locator > Fees, type 'clinic') by Safepay from the dashboard;
--       - every FURTHER clinic is added 'awaiting payment' and goes live for 12 months when its
--         own clinic fee is paid by Safepay (renewable each year).
--   * search now returns each place's opening hours.
--
-- Safe to run more than once. See ROLLBACK-0097.sql.

-- ------------------------------------------------------------- opening-hours checker
create or replace function public.locator_hours_ok(h jsonb)
returns boolean language plpgsql immutable as $fn$
declare k text; d text; v jsonb; rng jsonb;
begin
  if h is null then return true; end if;
  if jsonb_typeof(h) <> 'object' or pg_column_size(h) > 1500 then return false; end if;
  for k in select jsonb_object_keys(h) loop
    if k not in ('always', 'days') then return false; end if;
  end loop;
  if h ? 'always' and jsonb_typeof(h->'always') <> 'boolean' then return false; end if;
  if h ? 'days' then
    if jsonb_typeof(h->'days') <> 'object' then return false; end if;
    for d in select jsonb_object_keys(h->'days') loop
      if d not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then return false; end if;
      v := h->'days'->d;
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 2 then return false; end if;
      for rng in select jsonb_array_elements(v) loop
        if jsonb_typeof(rng) <> 'array' or jsonb_array_length(rng) <> 2 then return false; end if;
        if jsonb_typeof(rng->0) <> 'string' or jsonb_typeof(rng->1) <> 'string' then return false; end if;
        if (rng->>0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (rng->>1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
end;
$fn$;

-- ------------------------------------------------------------ places: widen + new column
alter table public.locator_places add column if not exists hours jsonb;
alter table public.locator_places drop constraint if exists locator_places_hours_check;
alter table public.locator_places add constraint locator_places_hours_check check (public.locator_hours_ok(hours));

alter table public.locator_places drop constraint if exists locator_places_category_check;
alter table public.locator_places add constraint locator_places_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism'));

alter table public.locator_places drop constraint if exists locator_places_source_check;
alter table public.locator_places add constraint locator_places_source_check
  check (source in ('admin', 'public', 'owner', 'doctor'));

-- existing pharmacies move to their own tab (a pharmacy is the only kind in it)
update public.locator_places set category = 'pharmacy' where kind = 'pharmacy' and category = 'doctor';
alter table public.locator_places drop constraint if exists locator_places_pharmacy_check;
alter table public.locator_places add constraint locator_places_pharmacy_check
  check ((kind = 'pharmacy') = (category = 'pharmacy'));

alter table public.locator_events_daily drop constraint if exists locator_events_daily_category_check;
alter table public.locator_events_daily add constraint locator_events_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism', 'none'));
alter table public.locator_search_areas_daily drop constraint if exists locator_search_areas_daily_category_check;
alter table public.locator_search_areas_daily add constraint locator_search_areas_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism'));

-- --------------------------------------------------------------- counters learn 'pharmacy'
create or replace function public.locator_event(p_event text, p_category text default 'none')
returns void language plpgsql security definer set search_path = public as $$
declare
  cat text := case when p_category in ('doctor', 'pharmacy', 'therapy', 'autism') then p_category else 'none' end;
begin
  if p_event not in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                     'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report') then
    return;
  end if;
  insert into public.locator_events_daily (day, event, category, n)
  values ((now() at time zone 'Asia/Karachi')::date, p_event, cat, 1)
  on conflict (day, event, category) do update set n = public.locator_events_daily.n + 1;
end;
$$;

create or replace function public.locator_search_note(p_area text, p_category text, p_found boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_category not in ('doctor', 'pharmacy', 'therapy', 'autism') then return; end if;
  if p_area is null or char_length(btrim(p_area)) = 0 or char_length(p_area) > 80 then return; end if;
  insert into public.locator_search_areas_daily (day, area, category, searches, empty)
  values (d, btrim(p_area), p_category, 1, case when p_found then 0 else 1 end)
  on conflict (day, area, category) do update
    set searches = public.locator_search_areas_daily.searches + 1,
        empty = public.locator_search_areas_daily.empty + case when p_found then 0 else 1 end;
end;
$$;

-- ------------------------------------------------------------------ public search v3
drop function if exists public.locator_search(double precision, double precision, numeric, text, text);

create function public.locator_search(
  p_lat double precision,
  p_lng double precision,
  p_radius_km numeric default 5,
  p_category text default 'doctor',
  p_kind text default null
)
returns table (
  id uuid, category text, kind text, name text, area text, address text, phone text,
  notes text, doctor_id uuid, orientation_date date, distance_km numeric,
  map_lat numeric, map_lng numeric, verified boolean, verified_on date, featured boolean,
  hours jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := least(greatest(coalesce(p_radius_km, 5), 1), 10);
begin
  if p_lat is null or p_lng is null then return; end if;
  if p_category not in ('doctor', 'pharmacy', 'therapy', 'autism') then return; end if;
  if not coalesce((select s.is_live from public.locator_settings s where s.id = 1), true) then return; end if;
  if p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then return; end if;

  return query
  with hits as (
    select
      p.id, p.category, p.kind, p.name, p.area, p.address, p.phone, p.notes,
      p.doctor_id, p.orientation_date, p.hours as phours,
      round((
        6371.0 * 2 * asin(least(1.0, sqrt(
          power(sin(radians(p.lat::double precision - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(p.lat::double precision)) *
          power(sin(radians(p.lng::double precision - p_lng) / 2), 2)
        )))
      )::numeric, 1) as dist,
      round(p.lat, 3) as mlat, round(p.lng, 3) as mlng,
      (p.verification_status = 'verified') as is_verified,
      case when p.verification_status = 'verified' then p.reviewed_at::date end as vdate,
      (p.featured_until is not null and p.featured_until > now()) as is_featured
    from public.locator_places p
    where p.status = 'approved'
      and p.category = p_category
      and p.city = 'Karachi'
      and (p.category = 'autism' or (p.paid_until is not null and p.paid_until > now()))
      and (p_kind is null or p.kind = p_kind)
      and p.lat::double precision between p_lat - (r / 111.0) - 0.01 and p_lat + (r / 111.0) + 0.01
  ), ranked as (
    select h.*,
           row_number() over (partition by h.is_featured order by h.dist, h.name) as frank
    from hits h where h.dist <= r
  )
  select q.id, q.category, q.kind, q.name, q.area, q.address, q.phone, q.notes,
         q.doctor_id, q.orientation_date, q.dist, q.mlat, q.mlng, q.is_verified, q.vdate,
         (q.is_featured and q.frank <= 2), q.phours
  from ranked q
  order by (q.is_featured and q.frank <= 2) desc, q.dist asc, q.name asc
  limit 60;
end;
$$;
revoke all on function public.locator_search(double precision, double precision, numeric, text, text) from public;
grant execute on function public.locator_search(double precision, double precision, numeric, text, text) to anon, authenticated, service_role;

create or replace function public.locator_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select s.is_live from public.locator_settings s where s.id = 1), true),
    'doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now()),
    'pharmacy', (select count(*) from public.locator_places where status = 'approved' and category = 'pharmacy' and paid_until > now()),
    'therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now()),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism')
  );
$$;
revoke all on function public.locator_counts() from public;
grant execute on function public.locator_counts() to anon, authenticated, service_role;

-- --------------------------------------------------------- owner application (+ hours)
drop function if exists public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean);

create or replace function public.locator_apply_place(
  p_category text, p_kind text, p_name text, p_area text, p_address text, p_phone text,
  p_notes text, p_lat double precision, p_lng double precision,
  p_owner_name text, p_owner_phone text, p_owner_email text, p_registration text,
  p_phone_verified boolean, p_token_hash text, p_consent boolean, p_hours jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f public.locator_fees%rowtype;
  new_id uuid;
  want text;
begin
  if p_consent is not true then raise exception 'consent_required'; end if;
  if p_category not in ('doctor', 'pharmacy', 'therapy') then raise exception 'bad_category'; end if;
  select * into f from public.locator_fees where kind = p_kind and accepts_applications;
  if not found then raise exception 'bad_kind'; end if;
  want := case when p_kind = 'pharmacy' then 'pharmacy'
               when p_kind in ('rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology') then 'therapy'
               else 'doctor' end;
  if p_category <> want then raise exception 'bad_kind'; end if;
  if not public.locator_hours_ok(p_hours) then raise exception 'bad_hours'; end if;
  if p_lat is null or p_lng is null
     or p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then
    raise exception 'outside_pilot';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then raise exception 'bad_token'; end if;
  if (select count(*) from public.locator_places where status = 'pending') >= 400 then raise exception 'queue_full'; end if;
  if (select count(*) from public.locator_places where source = 'owner' and paid_until is null
        and created_at > now() - interval '1 day') >= 300 then raise exception 'queue_full'; end if;
  if exists (
    select 1 from public.locator_places x
    where lower(x.name) = lower(btrim(p_name))
      and abs(x.lat::double precision - p_lat) < 0.0014 and abs(x.lng::double precision - p_lng) < 0.0014
  ) then
    raise exception 'duplicate';
  end if;

  insert into public.locator_places (
    category, kind, name, city, area, address, phone, notes, lat, lng, status, source,
    consent_confirmed, owner_name, owner_phone, owner_email, registration_numbers,
    phone_verified, manage_token_hash, verification_status, hours
  ) values (
    p_category, p_kind, btrim(p_name), 'Karachi', btrim(p_area),
    nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), round(p_lat::numeric, 6), round(p_lng::numeric, 6),
    case when f.requires_verification then 'pending' else 'approved' end, 'owner',
    true, nullif(btrim(coalesce(p_owner_name, '')), ''), nullif(btrim(coalesce(p_owner_phone, '')), ''),
    nullif(btrim(coalesce(p_owner_email, '')), ''), nullif(btrim(coalesce(p_registration, '')), ''),
    coalesce(p_phone_verified, false), p_token_hash,
    case when f.requires_verification then 'pending' else 'not_required' end,
    p_hours
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'requires_verification', f.requires_verification, 'fee_pkr', f.fee_pkr);
end;
$$;
revoke all on function public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean, jsonb) to service_role;

-- ------------------------------------------------------------- admin summary (+ pharmacy)
create or replace function public.locator_admin_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  return jsonb_build_object(
    'is_live', coalesce((select is_live from public.locator_settings where id = 1), true),
    'places', jsonb_build_object(
      'live_doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now()),
      'live_pharmacy', (select count(*) from public.locator_places where status = 'approved' and category = 'pharmacy' and paid_until > now()),
      'live_therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now()),
      'live_autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism'),
      'pending', (select count(*) from public.locator_places where status = 'pending'),
      'awaiting_payment', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','pharmacy','therapy') and (paid_until is null)),
      'expiring_30d', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','pharmacy','therapy') and paid_until > now() and paid_until < now() + interval '30 days'),
      'expired', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','pharmacy','therapy') and paid_until is not null and paid_until <= now()),
      'hidden', (select count(*) from public.locator_places where status = 'hidden')
    ),
    'open_reports', (select count(*) from public.locator_reports where status = 'open'),
    'waitlist', (select count(*) from public.locator_waitlist),
    'revenue_30d', coalesce((select sum(amount) from public.locator_payments where status = 'succeeded' and paid_at > now() - interval '30 days' and method <> 'complimentary'), 0),
    'revenue_total', coalesce((select sum(amount) from public.locator_payments where status = 'succeeded' and method <> 'complimentary'), 0),
    'events_7d', coalesce((select jsonb_object_agg(event, n) from (select event, sum(n)::bigint as n from public.locator_events_daily where day > today - 7 group by event) e), '{}'::jsonb),
    'events_30d', coalesce((select jsonb_object_agg(event, n) from (select event, sum(n)::bigint as n from public.locator_events_daily where day > today - 30 group by event) e), '{}'::jsonb),
    'by_tab_30d', coalesce((
      select jsonb_object_agg(category, o) from (
        select category, jsonb_object_agg(event, n) as o from (
          select category, event, sum(n)::bigint as n from public.locator_events_daily
          where day > today - 30 and category <> 'none' group by category, event) t group by category) u), '{}'::jsonb),
    'top_areas_30d', coalesce((
      select jsonb_agg(jsonb_build_object('area', area, 'searches', s, 'empty', e) order by s desc) from (
        select area, sum(searches)::int as s, sum(empty)::int as e from public.locator_search_areas_daily
        where day > today - 30 group by area order by 2 desc limit 12) a), '[]'::jsonb),
    'top_places_30d', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'shown', shown, 'directions', dirs, 'call', calls, 'book', books) order by dirs + calls desc, shown desc) from (
        select p.id, p.name,
               coalesce(sum(n) filter (where e.event = 'shown'), 0)::int as shown,
               coalesce(sum(n) filter (where e.event = 'directions'), 0)::int as dirs,
               coalesce(sum(n) filter (where e.event = 'call'), 0)::int as calls,
               coalesce(sum(n) filter (where e.event = 'book'), 0)::int as books
        from public.locator_place_events_daily e join public.locator_places p on p.id = e.place_id
        where e.day > today - 30 group by p.id, p.name
        order by (coalesce(sum(n) filter (where e.event = 'directions'), 0) + coalesce(sum(n) filter (where e.event = 'call'), 0)) desc,
                 coalesce(sum(n) filter (where e.event = 'shown'), 0) desc limit 12) tp), '[]'::jsonb),
    'waitlist_cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc) from (
        select initcap(lower(city)) as city, count(*)::int as n from public.locator_waitlist group by 1 order by 2 desc limit 15) w), '[]'::jsonb)
  );
end;
$$;


-- ======================================================= doctors add their own clinic
-- Who counts as "paid": an approved, active doctor whose access is active (the one-time
-- PKR 2,500 through Safepay, or marked paid by admin). Same test the doctor screens use.
create or replace function public.locator_doctor_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d public.doctor_profiles%rowtype;
  n int; first_at timestamptz; free_until timestamptz; f public.locator_fees%rowtype;
  slot_used boolean;
begin
  if auth.uid() is null then return jsonb_build_object('doctor', false); end if;
  select * into d from public.doctor_profiles where id = auth.uid();
  if not found then return jsonb_build_object('doctor', false); end if;
  select * into f from public.locator_fees where kind = 'clinic';
  select count(*), min(created_at) into n, first_at
    from public.locator_places where doctor_id = d.id and source = 'doctor';
  if first_at is not null then free_until := first_at + interval '12 months'; end if;
  -- ONE clinic per doctor is covered by the PKR 2,500 access fee (free for the first year);
  -- every further clinic pays the clinic fee from the start.
  slot_used := exists (
    select 1 from public.locator_places x join public.locator_payments y on y.place_id = x.id
    where x.doctor_id = d.id and x.source = 'doctor' and x.status <> 'hidden'
      and y.method = 'complimentary' and y.note like 'Free first year:%');
  return jsonb_build_object(
    'doctor', true,
    'eligible', (d.verification_status = 'approved' and d.is_active
                 and d.subscription_status = 'active'
                 and (d.subscription_current_period_end is null or d.subscription_current_period_end > now())),
    'reason', case
                when d.verification_status <> 'approved' or not d.is_active then 'not_approved'
                when d.subscription_status <> 'active'
                  or (d.subscription_current_period_end is not null and d.subscription_current_period_end <= now()) then 'unpaid'
                else null end,
    'full_name', d.full_name,
    'active_places', (select count(*) from public.locator_places where doctor_id = d.id and source = 'doctor' and status <> 'hidden'),
    'max_places', 10,
    'fee_pkr', coalesce(f.fee_pkr, 0),
    'free_until', free_until,
    'free_available', (not slot_used) and (free_until is null or free_until > now())
  );
end;
$$;

create or replace function public.locator_doctor_my_places()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'area', p.area, 'address', p.address, 'phone', p.phone,
      'notes', p.notes, 'lat', p.lat, 'lng', p.lng, 'hours', p.hours, 'status', p.status,
      'paid_until', p.paid_until,
      'live', (p.status = 'approved' and p.paid_until is not null and p.paid_until > now()),
      'free', exists (select 1 from public.locator_payments y where y.place_id = p.id
                      and y.method = 'complimentary' and y.note like 'Free first year:%')
    ) order by p.created_at)
    from public.locator_places p
    where p.doctor_id = auth.uid() and p.source = 'doctor' and p.status <> 'hidden'), '[]'::jsonb);
end;
$$;

-- Add (p_id null) or change (p_id = the clinic) one of the doctor's own clinics.
create or replace function public.locator_doctor_save_place(
  p_id uuid, p_name text, p_area text, p_address text, p_phone text, p_notes text,
  p_lat double precision, p_lng double precision, p_hours jsonb, p_consent boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.doctor_profiles%rowtype;
  uid uuid := auth.uid();
  first_at timestamptz; win_end timestamptz; new_id uuid; ends timestamptz; n int;
  slot_used boolean; is_free boolean;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into d from public.doctor_profiles where id = uid;
  if not found then raise exception 'not_doctor'; end if;
  if not (d.verification_status = 'approved' and d.is_active and d.subscription_status = 'active'
          and (d.subscription_current_period_end is null or d.subscription_current_period_end > now())) then
    raise exception 'not_eligible';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then raise exception 'bad_name'; end if;
  if p_area is null or char_length(btrim(p_area)) not between 2 and 80 then raise exception 'bad_area'; end if;
  if p_address is not null and char_length(p_address) > 240 then raise exception 'bad_address'; end if;
  if p_phone is not null and char_length(p_phone) > 30 then raise exception 'bad_phone'; end if;
  if p_notes is not null and char_length(p_notes) > 400 then raise exception 'bad_notes'; end if;
  if not public.locator_hours_ok(p_hours) then raise exception 'bad_hours'; end if;
  if p_lat is null or p_lng is null
     or p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then
    raise exception 'outside_pilot';
  end if;

  if p_id is not null then
    update public.locator_places set
      name = btrim(p_name), area = btrim(p_area),
      address = nullif(btrim(coalesce(p_address, '')), ''), phone = nullif(btrim(coalesce(p_phone, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      lat = round(p_lat::numeric, 6), lng = round(p_lng::numeric, 6), hours = p_hours
     where id = p_id and doctor_id = uid and source = 'doctor' and status <> 'hidden'
    returning paid_until into ends;
    if not found then raise exception 'not_found'; end if;
    return jsonb_build_object('id', p_id, 'created', false, 'paid_until', ends);
  end if;

  if p_consent is not true then raise exception 'consent_required'; end if;
  select count(*) into n from public.locator_places where doctor_id = uid and source = 'doctor' and status <> 'hidden';
  if n >= 10 then raise exception 'limit_reached'; end if;
  if exists (
    select 1 from public.locator_places x
    where x.status <> 'hidden' and lower(x.name) = lower(btrim(p_name))
      and abs(x.lat::double precision - p_lat) < 0.0014 and abs(x.lng::double precision - p_lng) < 0.0014
  ) then
    raise exception 'duplicate';
  end if;

  -- ONE clinic per doctor is covered by the access fee: free for 12 months counted from the
  -- doctor's FIRST clinic listing (hidden ones count too, so removing and re-adding does not
  -- restart the year). Every further clinic is added "awaiting payment" (paid_until null) and
  -- goes live when the clinic fee is paid through Safepay.
  select min(created_at) into first_at from public.locator_places where doctor_id = uid and source = 'doctor';
  win_end := coalesce(first_at, now()) + interval '12 months';
  slot_used := exists (
    select 1 from public.locator_places x join public.locator_payments y on y.place_id = x.id
    where x.doctor_id = uid and x.source = 'doctor' and x.status <> 'hidden'
      and y.method = 'complimentary' and y.note like 'Free first year:%');
  is_free := (not slot_used) and win_end > now();
  ends := case when is_free then win_end else null end;

  insert into public.locator_places (
    category, kind, name, city, area, address, phone, notes, lat, lng, status, source,
    consent_confirmed, owner_name, doctor_id, verification_status, verification_notes,
    reviewed_at, paid_until, hours
  ) values (
    'doctor', 'clinic', btrim(p_name), 'Karachi', btrim(p_area),
    nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), round(p_lat::numeric, 6), round(p_lng::numeric, 6),
    'approved', 'doctor', true, d.full_name, uid, 'verified',
    'Doctor verified by Family Medic; clinic added by the doctor from the dashboard.',
    now(), ends, p_hours
  ) returning id into new_id;

  if is_free then
    insert into public.locator_payments (place_id, amount, method, status, months, note, receipt_no, paid_at)
    values (new_id, 0, 'complimentary', 'succeeded', 12,
            'Free first year: doctor access (PKR 2,500) paid through Family Medic',
            nextval('public.locator_receipt_seq'), now());
  end if;
  return jsonb_build_object('id', new_id, 'created', true, 'paid_until', ends, 'free', is_free);
end;
$$;

create or replace function public.locator_doctor_remove_place(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  update public.locator_places set status = 'hidden'
   where id = p_id and doctor_id = auth.uid() and source = 'doctor' and status <> 'hidden';
  return found;
end;
$$;

-- server only: what the renewal checkout needs for one of the doctor's clinics
create or replace function public.locator_doctor_checkout_info(p_doctor uuid, p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.locator_places%rowtype; f public.locator_fees%rowtype; d public.doctor_profiles%rowtype;
begin
  select * into d from public.doctor_profiles where id = p_doctor;
  if not found or d.verification_status <> 'approved' or not d.is_active then return null; end if;
  select * into p from public.locator_places where id = p_place and doctor_id = p_doctor and source = 'doctor' and status = 'approved';
  if not found then return null; end if;
  select * into f from public.locator_fees where kind = p.kind;
  return jsonb_build_object('id', p.id, 'fee_pkr', coalesce(f.fee_pkr, 0), 'paid_until', p.paid_until,
    'renewable', (p.paid_until is null or p.paid_until < now() + interval '60 days'));
end;
$$;

-- --------------------------------------------------------------------------- grants
revoke all on function public.locator_hours_ok(jsonb) from public;
grant execute on function public.locator_hours_ok(jsonb) to anon, authenticated, service_role;
revoke all on function public.locator_event(text, text) from public, anon, authenticated;
grant execute on function public.locator_event(text, text) to service_role;
revoke all on function public.locator_search_note(text, text, boolean) from public, anon, authenticated;
grant execute on function public.locator_search_note(text, text, boolean) to service_role;
revoke all on function public.locator_admin_summary() from public, anon;
grant execute on function public.locator_admin_summary() to authenticated;

revoke all on function public.locator_doctor_status() from public, anon;
revoke all on function public.locator_doctor_my_places() from public, anon;
revoke all on function public.locator_doctor_save_place(uuid, text, text, text, text, text, double precision, double precision, jsonb, boolean) from public, anon;
revoke all on function public.locator_doctor_remove_place(uuid) from public, anon;
revoke all on function public.locator_doctor_checkout_info(uuid, uuid) from public, anon, authenticated;
grant execute on function public.locator_doctor_status() to authenticated;
grant execute on function public.locator_doctor_my_places() to authenticated;
grant execute on function public.locator_doctor_save_place(uuid, text, text, text, text, text, double precision, double precision, jsonb, boolean) to authenticated;
grant execute on function public.locator_doctor_remove_place(uuid) to authenticated;
grant execute on function public.locator_doctor_checkout_info(uuid, uuid) to service_role;
