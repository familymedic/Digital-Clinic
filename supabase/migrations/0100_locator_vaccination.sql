-- 0100: Locator, vaccination centres (2026-11-24). Run AFTER 0095 to 0099.
--
-- What this adds:
--   * A fifth tab: category 'vaccination' (kind 'vaccination'): government centres where children
--     can be vaccinated. They are FREE and need no payment and no verification step: a centre is
--     public as soon as an admin adds it (status 'approved'), like the autism-aware places.
--   * Extra fields on a place: district, vaccines (what is given / age groups), source_note
--     (where the entry came from) and last_verified (date).
--   * Admin-only ways to add centres, both checked in the database (not only in the screen):
--       locator_admin_vacc_import(rows, commit, label)  many centres at once (Excel / CSV upload),
--                                                        with a dry run (commit = false) for the preview
--       locator_admin_vacc_update(id, row)               edit one centre
--       locator_admin_vacc_undo(batch)                   remove the centres a named upload added
--     A single centre is added with the same import function (one row), so one set of rules applies.
--   * Search returns the new fields; counts include 'vaccination'; the counted Directions link works
--     for vaccination centres; the tracker learns the 'share' event (Share button) and the
--     'vaccination' category.
--
-- Safe to run more than once. See ROLLBACK-0100.sql.

-- ------------------------------------------------------------ columns + batch table
alter table public.locator_places
  add column if not exists district text check (district is null or char_length(district) <= 60),
  add column if not exists vaccines text check (vaccines is null or char_length(vaccines) <= 300),
  add column if not exists source_note text check (source_note is null or char_length(source_note) <= 200),
  add column if not exists last_verified date,
  add column if not exists import_batch uuid;

create index if not exists locator_places_batch_idx on public.locator_places (import_batch) where import_batch is not null;

create table if not exists public.locator_import_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 120),
  rows_added int not null default 0,
  rows_updated int not null default 0,
  rows_skipped int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table public.locator_import_batches enable row level security;
revoke all on public.locator_import_batches from anon;
grant select on public.locator_import_batches to authenticated;
drop policy if exists "Admins can view import batches" on public.locator_import_batches;
create policy "Admins can view import batches"
  on public.locator_import_batches for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ------------------------------------------------------------ category / kind rules
alter table public.locator_places drop constraint if exists locator_places_category_check;
alter table public.locator_places add constraint locator_places_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination'));

alter table public.locator_places drop constraint if exists locator_places_kind_check;
alter table public.locator_places add constraint locator_places_kind_check
  check (kind in (
    'clinic', 'doctor', 'hospital', 'lab', 'pharmacy', 'therapy',
    'rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology',
    'vaccination',
    'school', 'barber', 'salon', 'restaurant', 'cafe', 'market', 'park', 'mall', 'other'));

alter table public.locator_places drop constraint if exists locator_places_vaccination_check;
alter table public.locator_places add constraint locator_places_vaccination_check
  check ((kind = 'vaccination') = (category = 'vaccination'));

alter table public.locator_events_daily drop constraint if exists locator_events_daily_category_check;
alter table public.locator_events_daily add constraint locator_events_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination', 'none'));
alter table public.locator_search_areas_daily drop constraint if exists locator_search_areas_daily_category_check;
alter table public.locator_search_areas_daily add constraint locator_search_areas_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination'));

-- ------------------------------------------------------------ tracker: 'share' + vaccination
alter table public.locator_events_daily drop constraint if exists locator_events_daily_event_check;
alter table public.locator_events_daily add constraint locator_events_daily_event_check
  check (event in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                   'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report', 'widen', 'share'));

create or replace function public.locator_event(p_event text, p_category text default 'none')
returns void language plpgsql security definer set search_path = public as $$
declare
  cat text := case when p_category in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination') then p_category else 'none' end;
begin
  if p_event not in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                     'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report', 'widen', 'share') then
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
  if p_category not in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination') then return; end if;
  if p_area is null or char_length(btrim(p_area)) = 0 or char_length(p_area) > 80 then return; end if;
  insert into public.locator_search_areas_daily (day, area, category, searches, empty)
  values (d, btrim(p_area), p_category, 1, case when p_found then 0 else 1 end)
  on conflict (day, area, category) do update
    set searches = public.locator_search_areas_daily.searches + 1,
        empty = public.locator_search_areas_daily.empty + case when p_found then 0 else 1 end;
end;
$$;

-- ------------------------------------------------------------ public search (adds the new fields)
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
  hours jsonb, vaccines text, source_note text, last_verified date
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := least(greatest(coalesce(p_radius_km, 5), 1), 30);
begin
  if p_lat is null or p_lng is null then return; end if;
  if p_category not in ('doctor', 'pharmacy', 'therapy', 'autism', 'vaccination') then return; end if;
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
      (p.featured_until is not null and p.featured_until > now()) as is_featured,
      p.vaccines as pvaccines, p.source_note as psource, p.last_verified as plast
    from public.locator_places p
    where p.status = 'approved'
      and p.category = p_category
      and (p.category in ('autism', 'vaccination') or (p.paid_until is not null and p.paid_until > now()))
      and (p_kind is null or p.kind = p_kind)
      and p.lat::double precision between p_lat - (r / 111.0) - 0.01 and p_lat + (r / 111.0) + 0.01
  ), ranked as (
    select h.*,
           row_number() over (partition by h.is_featured order by h.dist, h.name) as frank
    from hits h where h.dist <= r
  )
  select q.id, q.category, q.kind, q.name, q.area, q.address, q.phone, q.notes,
         q.doctor_id, q.orientation_date, q.dist, q.mlat, q.mlng, q.is_verified, q.vdate,
         (q.is_featured and q.frank <= 2), q.phours, q.pvaccines, q.psource, q.plast
  from ranked q
  order by (q.is_featured and q.frank <= 2) desc, q.dist asc, q.name asc
  limit 60;
end;
$$;
revoke all on function public.locator_search(double precision, double precision, numeric, text, text) from public;
grant execute on function public.locator_search(double precision, double precision, numeric, text, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------ counts (adds vaccination)
create or replace function public.locator_counts(p_city text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select s.is_live from public.locator_settings s where s.id = 1), true),
    'doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now() and (p_city is null or city = p_city)),
    'pharmacy', (select count(*) from public.locator_places where status = 'approved' and category = 'pharmacy' and paid_until > now() and (p_city is null or city = p_city)),
    'therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now() and (p_city is null or city = p_city)),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism' and (p_city is null or city = p_city)),
    'vaccination', (select count(*) from public.locator_places where status = 'approved' and category = 'vaccination' and (p_city is null or city = p_city))
  );
$$;

-- ------------------------------------------------------------ counted Directions link
create or replace function public.locator_directions_target(p_place uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.locator_places%rowtype;
begin
  select * into r from public.locator_places
   where id = p_place and status = 'approved'
     and (category in ('autism', 'vaccination') or (paid_until is not null and paid_until > now()));
  if not found then return null; end if;
  perform public.locator_place_event(p_place, 'directions');
  return jsonb_build_object('lat', r.lat, 'lng', r.lng, 'name', r.name, 'area', r.area);
end;
$$;

-- A shared link must open the map without being counted as the visitor's own Directions tap.
create or replace function public.locator_directions_target_quiet(p_place uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.locator_places%rowtype;
begin
  select * into r from public.locator_places
   where id = p_place and status = 'approved'
     and (category in ('autism', 'vaccination') or (paid_until is not null and paid_until > now()));
  if not found then return null; end if;
  return jsonb_build_object('lat', r.lat, 'lng', r.lng, 'name', r.name, 'area', r.area);
end;
$$;
revoke all on function public.locator_directions_target_quiet(uuid) from public;
grant execute on function public.locator_directions_target_quiet(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------ row checker (internal)
-- Turns one row of an upload into clean values, or says what is wrong. Not callable by the public.
create or replace function public.locator_vacc_check(p_row jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(p_row->>'name', '')), '');
  v_area text := nullif(btrim(coalesce(p_row->>'area', '')), '');
  v_district text := nullif(btrim(coalesce(p_row->>'district', '')), '');
  v_address text := nullif(btrim(coalesce(p_row->>'address', '')), '');
  v_phone text := nullif(btrim(coalesce(p_row->>'phone', '')), '');
  v_notes text := nullif(btrim(coalesce(p_row->>'notes', '')), '');
  v_vaccines text := nullif(btrim(coalesce(p_row->>'vaccines', '')), '');
  v_source text := nullif(btrim(coalesce(p_row->>'source_note', '')), '');
  v_lat double precision;
  v_lng double precision;
  v_hours jsonb;
  v_last date;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then return jsonb_build_object('ok', false, 'reason', 'name_missing_or_too_long'); end if;
  if v_area is null then v_area := v_district; end if;
  if v_area is null or char_length(v_area) < 2 or char_length(v_area) > 80 then return jsonb_build_object('ok', false, 'reason', 'area_missing'); end if;
  if v_district is not null and char_length(v_district) > 60 then return jsonb_build_object('ok', false, 'reason', 'district_too_long'); end if;
  if v_address is not null and char_length(v_address) > 240 then return jsonb_build_object('ok', false, 'reason', 'address_too_long'); end if;
  if v_phone is not null and char_length(v_phone) > 30 then return jsonb_build_object('ok', false, 'reason', 'phone_too_long'); end if;
  if v_notes is not null and char_length(v_notes) > 400 then return jsonb_build_object('ok', false, 'reason', 'notes_too_long'); end if;
  if v_vaccines is not null and char_length(v_vaccines) > 300 then return jsonb_build_object('ok', false, 'reason', 'vaccines_too_long'); end if;
  if v_source is not null and char_length(v_source) > 200 then return jsonb_build_object('ok', false, 'reason', 'source_too_long'); end if;

  if (p_row->>'lat') ~ '^-?[0-9]{1,2}(\.[0-9]+)?$' and (p_row->>'lng') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
    v_lat := (p_row->>'lat')::double precision;
    v_lng := (p_row->>'lng')::double precision;
  else
    return jsonb_build_object('ok', false, 'reason', 'no_location');
  end if;
  if v_lat not between 23.5 and 37.5 or v_lng not between 60.5 and 77.5 or public.locator_city_for(v_lat, v_lng) is null then
    return jsonb_build_object('ok', false, 'reason', 'outside_service_area');
  end if;

  v_hours := case when jsonb_typeof(p_row->'hours') = 'object' then p_row->'hours' else null end;
  if v_hours is not null and not public.locator_hours_ok(v_hours) then return jsonb_build_object('ok', false, 'reason', 'bad_hours'); end if;

  v_last := case when (p_row->>'last_verified') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                   (case when (p_row->>'last_verified')::date between date '2000-01-01' and (now() at time zone 'Asia/Karachi')::date
                         then (p_row->>'last_verified')::date end)
             end;
  return jsonb_build_object('ok', true, 'name', v_name, 'area', v_area, 'district', v_district, 'address', v_address,
    'phone', v_phone, 'notes', v_notes, 'vaccines', v_vaccines, 'source_note', v_source,
    'lat', round(v_lat::numeric, 6), 'lng', round(v_lng::numeric, 6), 'hours', v_hours,
    'last_verified', coalesce(v_last, (now() at time zone 'Asia/Karachi')::date));
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'unreadable_row');
end;
$$;
revoke all on function public.locator_vacc_check(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ admin: import (dry run or commit)
create or replace function public.locator_admin_vacc_import(p_rows jsonb, p_commit boolean default false, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; c jsonb; i int := 0;
  n_new int := 0; n_upd int := 0; n_err int := 0; n_dup int := 0;
  results jsonb := '[]'::jsonb;
  bid uuid;
  seen text[] := '{}';
  k text; ex uuid; st text; why text;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_rows'; end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'no_rows'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'too_many_rows'; end if;
  if p_commit and p_label is not null and char_length(btrim(p_label)) > 0 then
    insert into public.locator_import_batches (label, created_by) values (left(btrim(p_label), 120), auth.uid()) returning id into bid;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    c := public.locator_vacc_check(r);
    st := null; why := null; ex := null;
    if (c->>'ok')::boolean is not true then
      st := 'error'; why := c->>'reason'; n_err := n_err + 1;
    else
      k := lower(c->>'name') || '|' || round((c->>'lat')::numeric, 3)::text || '|' || round((c->>'lng')::numeric, 3)::text;
      if k = any(seen) then
        st := 'duplicate'; why := 'same_name_and_place_earlier_in_file'; n_dup := n_dup + 1;
      else
        seen := seen || k;
        select p.id into ex from public.locator_places p
         where p.category = 'vaccination' and lower(p.name) = lower(c->>'name')
           and abs(p.lat::double precision - (c->>'lat')::double precision) < 0.003
           and abs(p.lng::double precision - (c->>'lng')::double precision) < 0.003
         limit 1;
        if ex is null then
          st := 'new'; n_new := n_new + 1;
          if p_commit then
            insert into public.locator_places (
              category, kind, name, city, area, district, address, phone, notes, lat, lng, status, source,
              consent_confirmed, hours, vaccines, source_note, last_verified, import_batch, reviewed_at)
            values (
              'vaccination', 'vaccination', c->>'name',
              coalesce(public.locator_city_for((c->>'lat')::double precision, (c->>'lng')::double precision), 'Karachi'),
              c->>'area', c->>'district', c->>'address', c->>'phone', c->>'notes',
              (c->>'lat')::numeric, (c->>'lng')::numeric, 'approved', 'admin',
              false, case when jsonb_typeof(c->'hours') = 'object' then c->'hours' end,
              c->>'vaccines', c->>'source_note', (c->>'last_verified')::date, bid, now());
          end if;
        else
          st := 'update'; n_upd := n_upd + 1;
          if p_commit then
            update public.locator_places set
              area = c->>'area', district = c->>'district', address = c->>'address', phone = c->>'phone', notes = c->>'notes',
              lat = (c->>'lat')::numeric, lng = (c->>'lng')::numeric,
              hours = case when jsonb_typeof(c->'hours') = 'object' then c->'hours' end,
              vaccines = c->>'vaccines', source_note = c->>'source_note', last_verified = (c->>'last_verified')::date,
              reviewed_at = now()
            where id = ex;
          end if;
        end if;
      end if;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('row', i, 'name', coalesce(c->>'name', r->>'name'), 'status', st, 'reason', why));
  end loop;

  if bid is not null then
    update public.locator_import_batches set rows_added = n_new, rows_updated = n_upd, rows_skipped = n_err + n_dup where id = bid;
  end if;
  return jsonb_build_object('committed', p_commit, 'batch_id', bid,
    'counts', jsonb_build_object('new', n_new, 'update', n_upd, 'error', n_err, 'duplicate', n_dup),
    'results', results);
end;
$$;
revoke all on function public.locator_admin_vacc_import(jsonb, boolean, text) from public, anon;
grant execute on function public.locator_admin_vacc_import(jsonb, boolean, text) to authenticated;

-- ------------------------------------------------------------ admin: edit one centre
create or replace function public.locator_admin_vacc_update(p_id uuid, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if not exists (select 1 from public.locator_places where id = p_id and category = 'vaccination') then raise exception 'no_place'; end if;
  c := public.locator_vacc_check(p_row);
  if (c->>'ok')::boolean is not true then raise exception 'invalid:%', coalesce(c->>'reason', 'unreadable_row'); end if;
  update public.locator_places set
    name = c->>'name', area = c->>'area', district = c->>'district', address = c->>'address', phone = c->>'phone',
    notes = c->>'notes', lat = (c->>'lat')::numeric, lng = (c->>'lng')::numeric,
    hours = case when jsonb_typeof(c->'hours') = 'object' then c->'hours' end,
    vaccines = c->>'vaccines', source_note = c->>'source_note', last_verified = (c->>'last_verified')::date,
    reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.locator_admin_vacc_update(uuid, jsonb) from public, anon;
grant execute on function public.locator_admin_vacc_update(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ admin: undo one upload
-- Removes the centres that upload ADDED. Centres it only updated keep their new values.
create or replace function public.locator_admin_vacc_undo(p_batch uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if not exists (select 1 from public.locator_import_batches where id = p_batch and undone_at is null) then raise exception 'no_batch'; end if;
  delete from public.locator_places where import_batch = p_batch and category = 'vaccination';
  get diagnostics n = row_count;
  update public.locator_import_batches set undone_at = now() where id = p_batch;
  return n;
end;
$$;
revoke all on function public.locator_admin_vacc_undo(uuid) from public, anon;
grant execute on function public.locator_admin_vacc_undo(uuid) to authenticated;
