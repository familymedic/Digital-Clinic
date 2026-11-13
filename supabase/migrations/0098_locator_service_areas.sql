-- 0098: service areas (cities) for the Family Medic Locator (2026-11-13).
--
--   * Karachi is widened so that ALL of Bahria Town Karachi (about 186 sq km along the M-9)
--     and the outer towns (Gadap, Bin Qasim, Gharo side, Hub side) count as Karachi.
--   * Hyderabad (with Kotri and Jamshoro) is added as the second city.
--   * The old single "Karachi box" in the database is replaced by a small table of service areas
--     (public.locator_regions). Adding another Sindh city later = one new row here plus one line
--     in src/lib/locator.ts (REGIONS). Nothing else changes.
--   * Each place's city is now set automatically from its pin (trigger), so Hyderabad places are
--     labelled Hyderabad and Karachi places stay Karachi.
--   * search, counts (now with an optional city), owner application, "suggest a place" and the
--     doctor's own clinic all use the service areas instead of the old box.
--
-- Run AFTER 0097. Safe to run more than once. See ROLLBACK-0098.sql.

create table if not exists public.locator_regions (
  id serial primary key,
  city text not null check (char_length(city) between 2 and 60),
  province text not null default 'Sindh',
  lat_min double precision not null,
  lat_max double precision not null,
  lng_min double precision not null,
  lng_max double precision not null,
  center_lat double precision not null,
  center_lng double precision not null,
  active boolean not null default true,
  sort_order int not null default 100,
  constraint locator_regions_box_ok check (lat_min < lat_max and lng_min < lng_max)
);
alter table public.locator_regions enable row level security;
drop policy if exists "Admins can view locator regions" on public.locator_regions;
create policy "Admins can view locator regions" on public.locator_regions for select to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

-- Seed (only when the table is empty, so edits you make later are never overwritten).
insert into public.locator_regions (city, lat_min, lat_max, lng_min, lng_max, center_lat, center_lng, sort_order)
select * from (values
  ('Karachi',   24.75, 25.45, 66.60, 67.65, 24.8607, 67.0100, 10),
  ('Hyderabad', 25.28, 25.52, 68.18, 68.50, 25.3792, 68.3683, 20)
) v(city, lat_min, lat_max, lng_min, lng_max, center_lat, center_lng, sort_order)
where not exists (select 1 from public.locator_regions);

-- Which service city does a point belong to? NULL = outside every active service area.
create or replace function public.locator_city_for(p_lat double precision, p_lng double precision)
returns text language sql stable security definer set search_path = public as $$
  select r.city from public.locator_regions r
   where r.active and p_lat between r.lat_min and r.lat_max and p_lng between r.lng_min and r.lng_max
   order by r.sort_order, r.id limit 1;
$$;
revoke all on function public.locator_city_for(double precision, double precision) from public;
grant execute on function public.locator_city_for(double precision, double precision) to anon, authenticated, service_role;

-- The list the website shows (names and centres only).
create or replace function public.locator_regions_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'lat', center_lat, 'lng', center_lng) order by sort_order, id), '[]'::jsonb)
    from public.locator_regions where active;
$$;
revoke all on function public.locator_regions_public() from public;
grant execute on function public.locator_regions_public() to anon, authenticated, service_role;

-- Every place carries the city its pin falls in.
create or replace function public.locator_places_set_city()
returns trigger language plpgsql set search_path = public as $$
begin
  new.city := coalesce(public.locator_city_for(new.lat::double precision, new.lng::double precision), new.city);
  return new;
end;
$$;
drop trigger if exists locator_places_set_city_trg on public.locator_places;
create trigger locator_places_set_city_trg before insert or update of lat, lng on public.locator_places
  for each row execute function public.locator_places_set_city();
update public.locator_places set city = public.locator_city_for(lat::double precision, lng::double precision)
 where public.locator_city_for(lat::double precision, lng::double precision) is not null
   and city is distinct from public.locator_city_for(lat::double precision, lng::double precision);

-- ------------------------------------------------------------------ public search (service areas)
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
  if public.locator_city_for(p_lat, p_lng) is null then return; end if;

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

-- ------------------------------------------------------------------ counts (optional city)
drop function if exists public.locator_counts();
create or replace function public.locator_counts(p_city text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select s.is_live from public.locator_settings s where s.id = 1), true),
    'doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now() and (p_city is null or city = p_city)),
    'pharmacy', (select count(*) from public.locator_places where status = 'approved' and category = 'pharmacy' and paid_until > now() and (p_city is null or city = p_city)),
    'therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now() and (p_city is null or city = p_city)),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism' and (p_city is null or city = p_city))
  );
$$;
revoke all on function public.locator_counts(text) from public;
grant execute on function public.locator_counts(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ owner application
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
  if p_lat is null or p_lng is null or public.locator_city_for(p_lat, p_lng) is null then
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
    p_category, p_kind, btrim(p_name), coalesce(public.locator_city_for(p_lat, p_lng), 'Karachi'), btrim(p_area),
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

-- ------------------------------------------------------------------ doctor's own clinic
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
  if p_lat is null or p_lng is null or public.locator_city_for(p_lat, p_lng) is null then
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
    'doctor', 'clinic', btrim(p_name), coalesce(public.locator_city_for(p_lat, p_lng), 'Karachi'), btrim(p_area),
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

-- ------------------------------------------------------------------ suggest a place
create or replace function public.locator_submit_place(
  p_category text, p_kind text, p_name text, p_area text, p_address text, p_phone text,
  p_notes text, p_lat double precision, p_lng double precision,
  p_by_name text, p_by_phone text, p_consent boolean
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if p_consent is not true then raise exception 'consent_required'; end if;
  if p_category not in ('doctor', 'autism') then raise exception 'bad_category'; end if;
  if p_lat is null or p_lng is null or public.locator_city_for(p_lat, p_lng) is null then
    raise exception 'outside_pilot';
  end if;
  if (select count(*) from public.locator_places where status = 'pending') >= 300 then
    raise exception 'queue_full';
  end if;
  -- duplicate: same name (case-insensitive) within about 150 m, any status
  if exists (
    select 1 from public.locator_places x
    where lower(x.name) = lower(btrim(p_name))
      and abs(x.lat::double precision - p_lat) < 0.0014
      and abs(x.lng::double precision - p_lng) < 0.0014
  ) then
    return null;
  end if;
  insert into public.locator_places (
    category, kind, name, city, area, address, phone, notes, lat, lng, status, source,
    consent_confirmed, submitted_by_name, submitted_by_phone
  ) values (
    p_category, p_kind, btrim(p_name), coalesce(public.locator_city_for(p_lat, p_lng), 'Karachi'), btrim(p_area),
    nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), round(p_lat::numeric, 6), round(p_lng::numeric, 6),
    'pending', 'public', true,
    nullif(btrim(coalesce(p_by_name, '')), ''), nullif(btrim(coalesce(p_by_phone, '')), '')
  ) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.locator_submit_place(text, text, text, text, text, text, text, double precision, double precision, text, text, boolean) from public, anon, authenticated;
grant execute on function public.locator_submit_place(text, text, text, text, text, text, text, double precision, double precision, text, text, boolean) to service_role;
