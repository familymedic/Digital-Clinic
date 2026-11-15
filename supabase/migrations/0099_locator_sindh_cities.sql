-- 0099: phase 1 service areas for the Family Medic Locator (2026-11-15).
--
--   * Adds Jamshoro, Sukkur, Khairpur and Larkana next to Karachi (which already covers Bahria
--     Town and DHA City) and Hyderabad. Jamshoro gets its own box that wins over Hyderabad where
--     the two overlap; Kotri stays with Hyderabad.
--   * A city can be marked "just opened": the website shows a small "Just opened, listings
--     growing" tag until the city has `min_places` visible places. Karachi is 0 (never tagged).
--   * locator_regions_public() now also tells the website which cities are still just opened.
--   * Existing places are re-labelled with the city their pin falls in.
--
--   * Search distance cap raised from 10 km to 30 km (the website widens 3 > 5 > 10 > 20 > 30 km).
--
-- Run AFTER 0098. Safe to run more than once. See ROLLBACK-0099.sql.
-- The boxes are generous rectangles around each city (they are not borders): look at Admin >
-- Locator after running and change a row's numbers if a real place is on the wrong side.

alter table public.locator_regions add column if not exists min_places int not null default 0
  check (min_places between 0 and 1000);

insert into public.locator_regions (city, lat_min, lat_max, lng_min, lng_max, center_lat, center_lng, sort_order, min_places)
select v.* from (values
  ('Jamshoro',  25.38, 25.60, 68.10, 68.32, 25.4296, 68.2800, 15, 25),
  ('Sukkur',    27.62, 27.82, 68.75, 68.98, 27.7052, 68.8574, 30, 25),
  ('Khairpur',  27.40, 27.62, 68.65, 68.90, 27.5295, 68.7592, 40, 25),
  ('Larkana',   27.35, 27.68, 68.05, 68.35, 27.5570, 68.2141, 50, 25)
) v(city, lat_min, lat_max, lng_min, lng_max, center_lat, center_lng, sort_order, min_places)
where not exists (select 1 from public.locator_regions r where r.city = v.city);

-- Hyderabad was added only days ago, so it carries the tag too until it has 25 places.
update public.locator_regions set min_places = 25 where city = 'Hyderabad' and min_places = 0;

create or replace function public.locator_regions_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'city', r.city, 'lat', r.center_lat, 'lng', r.center_lng,
           'just_opened', (select count(*) from public.locator_places p
                            where p.status = 'approved' and p.city = r.city
                              and (p.category = 'autism' or (p.paid_until is not null and p.paid_until > now()))) < r.min_places
         ) order by r.sort_order, r.id), '[]'::jsonb)
    from public.locator_regions r where r.active;
$$;
revoke all on function public.locator_regions_public() from public;
grant execute on function public.locator_regions_public() to anon, authenticated, service_role;

-- Re-label existing places (e.g. a Jamshoro pin that was saved as Hyderabad).
update public.locator_places set city = public.locator_city_for(lat::double precision, lng::double precision)
 where public.locator_city_for(lat::double precision, lng::double precision) is not null
   and city is distinct from public.locator_city_for(lat::double precision, lng::double precision);

-- ------------------------------------------------ search: radius up to 30 km (was 10)
-- Same function as 0098; the only change is the cap on the distance.
create or replace function public.locator_search(
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
  r double precision := least(greatest(coalesce(p_radius_km, 5), 1), 30);
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

-- --------------------------------------------- tracker: "search widened" event
-- Counts how often a search found too little close by and the page widened the distance by itself.
-- That number shows where families have no coverage.
alter table public.locator_events_daily drop constraint if exists locator_events_daily_event_check;
alter table public.locator_events_daily add constraint locator_events_daily_event_check
  check (event in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                   'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report', 'widen'));

create or replace function public.locator_event(p_event text, p_category text default 'none')
returns void language plpgsql security definer set search_path = public as $$
declare
  cat text := case when p_category in ('doctor', 'pharmacy', 'therapy', 'autism') then p_category else 'none' end;
begin
  if p_event not in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                     'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report', 'widen') then
    return;
  end if;
  insert into public.locator_events_daily (day, event, category, n)
  values ((now() at time zone 'Asia/Karachi')::date, p_event, cat, 1)
  on conflict (day, event, category) do update set n = public.locator_events_daily.n + 1;
end;
$$;
