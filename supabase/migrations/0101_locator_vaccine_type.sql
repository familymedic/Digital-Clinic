-- 0101: Locator, vaccine type + service fee for vaccination centres (2026-11-24). Run AFTER 0100.
--
--   * vaccine_type on a vaccination centre: 'government' (government vaccines), 'private' (private vaccines only)
--     or 'both'. Every centre already listed becomes 'government'.
--   * service_fee (yes / no): shows "Small service fee may apply" on that centre's card. Left off, nothing is claimed.
--   * Search: what a visitor sees first is the centres that give the government vaccine (government + both).
--     The "Private vaccines" filter (p_kind = 'private') shows centres that offer private vaccines (private + both).
--   * Counts: 'vaccination' = centres in the first view; 'vaccination_private' = centres with private vaccines
--     (the screen shows the filter only when this is more than zero).
--   * The upload / single-centre functions read both new values. A row that does not mention vaccine_type at all
--     counts as government (so older sheets still work); a row that leaves it empty or writes something else is
--     reported as a problem instead of being guessed.
--
-- Safe to run more than once. See ROLLBACK-0101.sql.

alter table public.locator_places
  add column if not exists vaccine_type text,
  add column if not exists service_fee boolean not null default false;
update public.locator_places set vaccine_type = 'government' where category = 'vaccination' and vaccine_type is null;
alter table public.locator_places drop constraint if exists locator_places_vaccine_type_check;
alter table public.locator_places add constraint locator_places_vaccine_type_check
  check (vaccine_type is null or vaccine_type in ('government', 'private', 'both'));
alter table public.locator_places drop constraint if exists locator_places_vaccine_type_rule;
alter table public.locator_places add constraint locator_places_vaccine_type_rule
  check ((category = 'vaccination') = (vaccine_type is not null)) not valid;

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
  v_vtype text;
  v_fee boolean;
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

  -- vaccines offered: government / private / both. A row that does not mention it at all counts as government
  -- (older sheets); a row that mentions it but leaves it empty or unreadable is a problem, never a guess.
  if p_row ? 'vaccine_type' then
    v_vtype := lower(btrim(coalesce(p_row->>'vaccine_type', '')));
    if v_vtype not in ('government', 'private', 'both') then return jsonb_build_object('ok', false, 'reason', 'vaccine_type_missing_or_unknown'); end if;
  else
    v_vtype := 'government';
  end if;
  v_fee := coalesce(lower(p_row->>'service_fee') in ('true', 't', 'yes', '1'), false);

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
    'vaccine_type', v_vtype, 'service_fee', v_fee,
    'lat', round(v_lat::numeric, 6), 'lng', round(v_lng::numeric, 6), 'hours', v_hours,
    'last_verified', coalesce(v_last, (now() at time zone 'Asia/Karachi')::date));
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'unreadable_row');
end;
$$;
revoke all on function public.locator_vacc_check(jsonb) from public, anon, authenticated;

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
              consent_confirmed, hours, vaccines, source_note, last_verified, import_batch, reviewed_at, vaccine_type, service_fee)
            values (
              'vaccination', 'vaccination', c->>'name',
              coalesce(public.locator_city_for((c->>'lat')::double precision, (c->>'lng')::double precision), 'Karachi'),
              c->>'area', c->>'district', c->>'address', c->>'phone', c->>'notes',
              (c->>'lat')::numeric, (c->>'lng')::numeric, 'approved', 'admin',
              false, case when jsonb_typeof(c->'hours') = 'object' then c->'hours' end,
              c->>'vaccines', c->>'source_note', (c->>'last_verified')::date, bid, now(), c->>'vaccine_type', (c->>'service_fee')::boolean);
          end if;
        else
          st := 'update'; n_upd := n_upd + 1;
          if p_commit then
            update public.locator_places set
              area = c->>'area', district = c->>'district', address = c->>'address', phone = c->>'phone', notes = c->>'notes',
              lat = (c->>'lat')::numeric, lng = (c->>'lng')::numeric,
              hours = case when jsonb_typeof(c->'hours') = 'object' then c->'hours' end,
              vaccines = c->>'vaccines', source_note = c->>'source_note', last_verified = (c->>'last_verified')::date,
              vaccine_type = c->>'vaccine_type', service_fee = (c->>'service_fee')::boolean,
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
    vaccine_type = c->>'vaccine_type', service_fee = (c->>'service_fee')::boolean,
    reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.locator_admin_vacc_update(uuid, jsonb) from public, anon;
grant execute on function public.locator_admin_vacc_update(uuid, jsonb) to authenticated;

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
  hours jsonb, vaccines text, source_note text, last_verified date,
  vaccine_type text, service_fee boolean
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
      p.vaccines as pvaccines, p.source_note as psource, p.last_verified as plast,
      p.vaccine_type as pvtype, p.service_fee as pfee
    from public.locator_places p
    where p.status = 'approved'
      and p.category = p_category
      and (p.category in ('autism', 'vaccination') or (p.paid_until is not null and p.paid_until > now()))
      and (
        case
          -- vaccination: what the visitor sees first = centres that give the government vaccine;
          -- p_kind 'private' = centres that offer private vaccines (private only, or both)
          when p_category = 'vaccination' then
            case when p_kind = 'private' then p.vaccine_type in ('private', 'both')
                 else coalesce(p.vaccine_type, 'government') in ('government', 'both') end
          else (p_kind is null or p.kind = p_kind)
        end)
      and p.lat::double precision between p_lat - (r / 111.0) - 0.01 and p_lat + (r / 111.0) + 0.01
  ), ranked as (
    select h.*,
           row_number() over (partition by h.is_featured order by h.dist, h.name) as frank
    from hits h where h.dist <= r
  )
  select q.id, q.category, q.kind, q.name, q.area, q.address, q.phone, q.notes,
         q.doctor_id, q.orientation_date, q.dist, q.mlat, q.mlng, q.is_verified, q.vdate,
         (q.is_featured and q.frank <= 2), q.phours, q.pvaccines, q.psource, q.plast, q.pvtype, q.pfee
  from ranked q
  order by (q.is_featured and q.frank <= 2) desc, q.dist asc, q.name asc
  limit 60;
end;
$$;
revoke all on function public.locator_search(double precision, double precision, numeric, text, text) from public;
grant execute on function public.locator_search(double precision, double precision, numeric, text, text) to anon, authenticated, service_role;

create or replace function public.locator_counts(p_city text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select s.is_live from public.locator_settings s where s.id = 1), true),
    'doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now() and (p_city is null or city = p_city)),
    'pharmacy', (select count(*) from public.locator_places where status = 'approved' and category = 'pharmacy' and paid_until > now() and (p_city is null or city = p_city)),
    'therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now() and (p_city is null or city = p_city)),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism' and (p_city is null or city = p_city)),
    'vaccination', (select count(*) from public.locator_places where status = 'approved' and category = 'vaccination' and coalesce(vaccine_type, 'government') in ('government', 'both') and (p_city is null or city = p_city)),
    'vaccination_private', (select count(*) from public.locator_places where status = 'approved' and category = 'vaccination' and vaccine_type in ('private', 'both') and (p_city is null or city = p_city))
  );
$$;
