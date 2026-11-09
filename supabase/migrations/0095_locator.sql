-- 0095: Family Medic Locator, Karachi pilot (2026-11-08).
--
-- One locator, two tabs:
--   * "doctor"  = Doctors & clinics near me
--   * "autism"  = Autism-aware places near me (barbers, restaurants, markets, schools...
--                 oriented by the Vulnerable Women and Children Organization volunteers)
--
-- Replaces the Habit Age game on the site. The old Habit Age tables (0084/0087) are NOT
-- touched; only the website pages are retired.
--
-- PRIVACY / SAFETY BY DESIGN
--   * No paid map or geocoding service. Distance is plain Haversine maths in SQL.
--   * The visitor's location is sent only to locator_search(), used for that one query and
--     never stored. Usage counters are anonymous (day + event + tab, no location, no user).
--   * Place coordinates are never returned to the browser: only the distance rounded to
--     0.1 km. "Directions" opens a Google Maps text search by name + area.
--   * Submitter name/phone (volunteers) are private and never leave admin screens.
--   * Public submissions land as 'pending' and are invisible until an admin approves them.
--   * Pilot city: Karachi (bounding box checked in the database too). Outside Karachi the
--     site shows "coming soon" and takes a notify-me sign-up (locator_waitlist).
--
-- Safe to run more than once. See ROLLBACK-0095.sql to remove it.
-- Requires admin_profiles (0025).

-- ---------------------------------------------------------------- settings
create table if not exists public.locator_settings (
  id int primary key default 1 check (id = 1),
  is_live boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.locator_settings (id) values (1) on conflict (id) do nothing;
alter table public.locator_settings enable row level security;

drop policy if exists "Anyone can read locator settings" on public.locator_settings;
create policy "Anyone can read locator settings"
  on public.locator_settings for select using (true);

drop policy if exists "Admins can edit locator settings" on public.locator_settings;
create policy "Admins can edit locator settings"
  on public.locator_settings for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ------------------------------------------------------------------ places
create table if not exists public.locator_places (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('doctor', 'autism')),
  kind text not null check (kind in (
    'clinic', 'doctor', 'hospital', 'lab', 'pharmacy', 'therapy',
    'school', 'barber', 'salon', 'restaurant', 'cafe', 'market', 'park', 'mall', 'other')),
  name text not null check (char_length(name) between 2 and 120),
  city text not null default 'Karachi' check (char_length(city) between 2 and 60),
  area text not null check (char_length(area) between 2 and 80),
  address text check (address is null or char_length(address) <= 240),
  phone text check (phone is null or char_length(phone) <= 30),
  notes text check (notes is null or char_length(notes) <= 400),
  lat numeric(9, 6) not null check (lat between 23.5 and 37.5),
  lng numeric(9, 6) not null check (lng between 60.5 and 77.5),
  doctor_id uuid,                       -- optional: links to a Family Medic doctor for "Book online"
  orientation_date date,                -- autism tab: when the team was oriented
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  source text not null default 'admin' check (source in ('admin', 'public')),
  consent_confirmed boolean not null default false,  -- owner agreed to be listed
  submitted_by_name text check (submitted_by_name is null or char_length(submitted_by_name) <= 80),
  submitted_by_phone text check (submitted_by_phone is null or char_length(submitted_by_phone) <= 30),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists locator_places_live_idx
  on public.locator_places (category, city) where status = 'approved';
create index if not exists locator_places_status_idx on public.locator_places (status, created_at desc);
alter table public.locator_places enable row level security;

-- Browsers (anon / logged-in patients) have NO direct access to this table; the public
-- reaches approved rows only through locator_search(), which hides coordinates.
revoke all on public.locator_places from anon;
grant select, insert, update, delete on public.locator_places to authenticated;

drop policy if exists "Admins can view locator places" on public.locator_places;
create policy "Admins can view locator places"
  on public.locator_places for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can add locator places" on public.locator_places;
create policy "Admins can add locator places"
  on public.locator_places for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can edit locator places" on public.locator_places;
create policy "Admins can edit locator places"
  on public.locator_places for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete locator places" on public.locator_places;
create policy "Admins can delete locator places"
  on public.locator_places for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------- waitlist
-- "Notify me when the locator reaches my city." Contact is a phone or an email.
create table if not exists public.locator_waitlist (
  id uuid primary key default gen_random_uuid(),
  city text not null check (char_length(city) between 2 and 60),
  contact text not null check (char_length(contact) between 5 and 120),
  interest text not null default 'both' check (interest in ('doctor', 'autism', 'both')),
  created_at timestamptz not null default now()
);
create unique index if not exists locator_waitlist_uq
  on public.locator_waitlist (lower(city), lower(contact));
alter table public.locator_waitlist enable row level security;
revoke all on public.locator_waitlist from anon;
grant select, delete on public.locator_waitlist to authenticated;

drop policy if exists "Admins can view locator waitlist" on public.locator_waitlist;
create policy "Admins can view locator waitlist"
  on public.locator_waitlist for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete locator waitlist" on public.locator_waitlist;
create policy "Admins can delete locator waitlist"
  on public.locator_waitlist for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ------------------------------------------------------- anonymous counters
create table if not exists public.locator_events_daily (
  day date not null,
  event text not null check (event in (
    'search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
    'gps_denied', 'coming_soon', 'waitlist', 'suggest')),
  category text not null check (category in ('doctor', 'autism', 'none')),
  n bigint not null default 0,
  primary key (day, event, category)
);
alter table public.locator_events_daily enable row level security;
revoke all on public.locator_events_daily from anon;
grant select on public.locator_events_daily to authenticated;

drop policy if exists "Admins can view locator events" on public.locator_events_daily;
create policy "Admins can view locator events"
  on public.locator_events_daily for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ------------------------------------------------------------ public search
-- Karachi pilot box. Anything outside it returns no rows (the website shows "coming soon").
-- Returns NO coordinates: distance only, rounded to 0.1 km. Capped at 60 results.
create or replace function public.locator_search(
  p_lat double precision,
  p_lng double precision,
  p_radius_km numeric default 5,
  p_category text default 'doctor',
  p_kind text default null
)
returns table (
  id uuid, category text, kind text, name text, area text, address text, phone text,
  notes text, doctor_id uuid, orientation_date date, distance_km numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := least(greatest(coalesce(p_radius_km, 5), 1), 10);
begin
  if p_lat is null or p_lng is null then return; end if;
  if p_category not in ('doctor', 'autism') then return; end if;
  if not coalesce((select s.is_live from public.locator_settings s where s.id = 1), true) then return; end if;
  -- Karachi pilot bounding box
  if p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then return; end if;

  return query
  select * from (
    select
      p.id, p.category, p.kind, p.name, p.area, p.address, p.phone, p.notes,
      p.doctor_id, p.orientation_date,
      round((
        6371.0 * 2 * asin(least(1.0, sqrt(
          power(sin(radians(p.lat::double precision - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(p.lat::double precision)) *
          power(sin(radians(p.lng::double precision - p_lng) / 2), 2)
        )))
      )::numeric, 1) as dist
    from public.locator_places p
    where p.status = 'approved'
      and p.category = p_category
      and p.city = 'Karachi'
      and (p_kind is null or p.kind = p_kind)
      -- cheap pre-filter (about 1 degree = 111 km) before the exact maths
      and p.lat::double precision between p_lat - (r / 111.0) - 0.01 and p_lat + (r / 111.0) + 0.01
  ) q
  where q.dist <= r
  order by q.dist asc, q.name asc
  limit 60;
end;
$$;
revoke all on function public.locator_search(double precision, double precision, numeric, text, text) from public;
grant execute on function public.locator_search(double precision, double precision, numeric, text, text) to anon, authenticated, service_role;

-- How many places are listed (shown on the page as "N places listed in Karachi").
create or replace function public.locator_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select s.is_live from public.locator_settings s where s.id = 1), true),
    'doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor'),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism')
  );
$$;
revoke all on function public.locator_counts() from public;
grant execute on function public.locator_counts() to anon, authenticated, service_role;

-- ------------------------------------------------ server-only write helpers
-- Only the website's own API routes (service_role) can call these, after they have
-- validated and rate-limited the request. Browsers cannot call them directly.

create or replace function public.locator_event(p_event text, p_category text default 'none')
returns void language plpgsql security definer set search_path = public as $$
declare
  cat text := case when p_category in ('doctor', 'autism') then p_category else 'none' end;
begin
  if p_event not in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                     'gps_denied', 'coming_soon', 'waitlist', 'suggest') then
    return;
  end if;
  insert into public.locator_events_daily (day, event, category, n)
  values ((now() at time zone 'Asia/Karachi')::date, p_event, cat, 1)
  on conflict (day, event, category) do update set n = public.locator_events_daily.n + 1;
end;
$$;
revoke all on function public.locator_event(text, text) from public, anon, authenticated;
grant execute on function public.locator_event(text, text) to service_role;

create or replace function public.locator_waitlist_add(p_city text, p_contact text, p_interest text default 'both')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  c text := btrim(coalesce(p_city, ''));
  k text := btrim(coalesce(p_contact, ''));
  i text := case when p_interest in ('doctor', 'autism', 'both') then p_interest else 'both' end;
begin
  if char_length(c) < 2 or char_length(c) > 60 then return false; end if;
  if char_length(k) < 5 or char_length(k) > 120 then return false; end if;
  -- very light shape check: an email, or a phone with at least 10 digits
  if k !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(regexp_replace(k, '\D', '', 'g')) < 10 then
    return false;
  end if;
  if (select count(*) from public.locator_waitlist) > 50000 then return false; end if;
  insert into public.locator_waitlist (city, contact, interest) values (c, k, i)
  on conflict (lower(city), lower(contact)) do update set interest = excluded.interest;
  return true;
end;
$$;
revoke all on function public.locator_waitlist_add(text, text, text) from public, anon, authenticated;
grant execute on function public.locator_waitlist_add(text, text, text) to service_role;

-- A volunteer, owner or doctor suggests a place. Lands as 'pending' (invisible) until an
-- admin approves it. Returns the new id, or null when it looks like a duplicate.
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
  if p_lat is null or p_lng is null
     or p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then
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
    p_category, p_kind, btrim(p_name), 'Karachi', btrim(p_area),
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

-- ---------------------------------------------------------- admin summary
create or replace function public.locator_admin_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'not_admin';
  end if;
  return jsonb_build_object(
    'is_live', coalesce((select is_live from public.locator_settings where id = 1), true),
    'places', jsonb_build_object(
      'approved_doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor'),
      'approved_autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism'),
      'pending', (select count(*) from public.locator_places where status = 'pending'),
      'hidden', (select count(*) from public.locator_places where status = 'hidden')
    ),
    'waitlist', (select count(*) from public.locator_waitlist),
    'events_7d', coalesce((
      select jsonb_object_agg(event, n) from (
        select event, sum(n)::bigint as n from public.locator_events_daily
        where day > today - 7 group by event) e), '{}'::jsonb),
    'events_30d', coalesce((
      select jsonb_object_agg(event, n) from (
        select event, sum(n)::bigint as n from public.locator_events_daily
        where day > today - 30 group by event) e), '{}'::jsonb),
    'waitlist_cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc) from (
        select initcap(lower(city)) as city, count(*)::int as n from public.locator_waitlist
        group by 1 order by 2 desc limit 15) w), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.locator_admin_summary() from public, anon;
grant execute on function public.locator_admin_summary() to authenticated;
