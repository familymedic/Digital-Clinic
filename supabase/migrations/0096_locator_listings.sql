-- 0096: Locator, paid + verified workplace listings (2026-11-09). Run AFTER 0095.
--
-- What this adds on top of 0095:
--   * A third tab: category 'therapy' (Therapy & Rehab) next to 'doctor' and 'autism'.
--   * Workplace applications from the public ("List your workplace"): clinics, hospitals,
--     labs, rehab / therapy centres need VERIFICATION by an admin first, then payment.
--     Pharmacies need no verification and pay at the same time.
--   * Annual fee per type, editable by admins (locator_fees). Placeholder amounts.
--   * A listing is public only while paid: category doctor/therapy => paid_until > now().
--     Autism-aware places stay free (paid_until not needed).
--   * Payments: Safepay (locator_payments) or recorded by an admin (cash / JazzCash / bank /
--     complimentary), with receipt numbers.
--   * Owner "manage link" (a random token, only its hash is stored): status, pay, stats.
--   * Per-place counters (shown / directions / call / book) and per-area search counters.
--   * "Report a problem" queue, optional "Featured" (labelled, max 2 per search).
--   * Phone-code helper tables (the code is delivered by the website's server).
--   * search now also returns each place's map position rounded to about 100 m so the page
--     can draw numbered pins. Exact coordinates only leave the server inside the counted
--     Directions link, one place at a time.
--
-- Safe to run more than once. See ROLLBACK-0096.sql (removes ONLY what this file added).

-- ----------------------------------------------------------- places: widen + new columns
alter table public.locator_places drop constraint if exists locator_places_category_check;
alter table public.locator_places add constraint locator_places_category_check
  check (category in ('doctor', 'therapy', 'autism'));

alter table public.locator_places drop constraint if exists locator_places_kind_check;
alter table public.locator_places add constraint locator_places_kind_check
  check (kind in (
    'clinic', 'doctor', 'hospital', 'lab', 'pharmacy', 'therapy',
    'rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology',
    'school', 'barber', 'salon', 'restaurant', 'cafe', 'market', 'park', 'mall', 'other'));

alter table public.locator_places drop constraint if exists locator_places_source_check;
alter table public.locator_places add constraint locator_places_source_check
  check (source in ('admin', 'public', 'owner'));

alter table public.locator_places
  add column if not exists owner_name text check (owner_name is null or char_length(owner_name) <= 80),
  add column if not exists owner_phone text check (owner_phone is null or char_length(owner_phone) <= 30),
  add column if not exists owner_email text check (owner_email is null or char_length(owner_email) <= 120),
  add column if not exists phone_verified boolean not null default false,
  add column if not exists verification_status text not null default 'not_required'
    check (verification_status in ('not_required', 'pending', 'verified', 'rejected')),
  add column if not exists verification_notes text check (verification_notes is null or char_length(verification_notes) <= 600),
  add column if not exists rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  add column if not exists registration_numbers text check (registration_numbers is null or char_length(registration_numbers) <= 300),
  add column if not exists proof_paths text[] not null default '{}',
  add column if not exists manage_token_hash text,
  add column if not exists paid_until timestamptz,
  add column if not exists featured_until timestamptz;

create index if not exists locator_places_token_idx on public.locator_places (manage_token_hash) where manage_token_hash is not null;

-- --------------------------------------------------------------------------- fees
create table if not exists public.locator_fees (
  kind text primary key,
  label text not null,
  fee_pkr int not null check (fee_pkr between 0 and 1000000),
  requires_verification boolean not null default true,
  accepts_applications boolean not null default true,
  sort_order int not null default 0
);
alter table public.locator_fees enable row level security;
revoke all on public.locator_fees from anon;
grant select on public.locator_fees to anon;
grant update on public.locator_fees to authenticated;

drop policy if exists "Anyone can read locator fees" on public.locator_fees;
create policy "Anyone can read locator fees" on public.locator_fees for select using (true);
drop policy if exists "Admins can edit locator fees" on public.locator_fees;
create policy "Admins can edit locator fees" on public.locator_fees for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- One time only (first run, while the fee table is still empty): places the admin already
-- approved under 0095 keep showing, with a 12-month courtesy period, instead of vanishing
-- the moment the paid-listing rule starts.
do $$ begin
  if not exists (select 1 from public.locator_fees) then
    update public.locator_places set paid_until = now() + interval '12 months'
     where status = 'approved' and category in ('doctor', 'therapy') and paid_until is null and source <> 'owner';
  end if;
end $$;

-- PLACEHOLDER amounts: change them in Admin > Locator > Fees whenever you finalize.
insert into public.locator_fees (kind, label, fee_pkr, requires_verification, sort_order) values
  ('clinic',         'Clinic',                 1500, true,  10),
  ('doctor',         'Family doctor / consultant', 1000, true, 20),
  ('hospital',       'Hospital',               1500, true,  30),
  ('lab',            'Lab',                    1500, true,  40),
  ('pharmacy',       'Pharmacy',               1000, false, 50),
  ('rehab',          'Rehab centre',           1500, true,  60),
  ('autism_therapy', 'Autism therapy centre',  1500, true,  70),
  ('physio',         'Physiotherapist / clinic', 1000, true, 80),
  ('speech',         'Speech therapist',       1000, true,  90),
  ('occupational',   'Occupational therapist', 1000, true,  100),
  ('psychology',     'Psychologist / counsellor', 1000, true, 110)
on conflict (kind) do nothing;

-- ------------------------------------------------------------------------ payments
create sequence if not exists public.locator_receipt_seq start 1001;

create table if not exists public.locator_payments (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.locator_places(id) on delete cascade,
  amount int not null check (amount >= 0),
  currency text not null default 'PKR',
  method text not null default 'safepay' check (method in ('safepay', 'cash', 'jazzcash', 'easypaisa', 'bank', 'complimentary', 'other')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  months int not null default 12 check (months between 1 and 36),
  gateway_environment text,
  gateway_tracker_token text,
  reference text check (reference is null or char_length(reference) <= 120),
  note text check (note is null or char_length(note) <= 300),
  receipt_no int,
  recorded_by uuid,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists locator_payments_place_idx on public.locator_payments (place_id, created_at desc);
create index if not exists locator_payments_tracker_idx on public.locator_payments (gateway_tracker_token) where gateway_tracker_token is not null;
alter table public.locator_payments enable row level security;
revoke all on public.locator_payments from anon;
grant select on public.locator_payments to authenticated;
drop policy if exists "Admins can view locator payments" on public.locator_payments;
create policy "Admins can view locator payments" on public.locator_payments for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------- per-place counters
create table if not exists public.locator_place_events_daily (
  place_id uuid not null references public.locator_places(id) on delete cascade,
  day date not null,
  event text not null check (event in ('shown', 'directions', 'call', 'book')),
  n bigint not null default 0,
  primary key (place_id, day, event)
);
alter table public.locator_place_events_daily enable row level security;
revoke all on public.locator_place_events_daily from anon;
grant select on public.locator_place_events_daily to authenticated;
drop policy if exists "Admins can view place events" on public.locator_place_events_daily;
create policy "Admins can view place events" on public.locator_place_events_daily for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

create table if not exists public.locator_search_areas_daily (
  day date not null,
  area text not null check (char_length(area) between 1 and 80),
  category text not null check (category in ('doctor', 'therapy', 'autism')),
  searches bigint not null default 0,
  empty bigint not null default 0,
  primary key (day, area, category)
);
alter table public.locator_search_areas_daily enable row level security;
revoke all on public.locator_search_areas_daily from anon;
grant select on public.locator_search_areas_daily to authenticated;
drop policy if exists "Admins can view search areas" on public.locator_search_areas_daily;
create policy "Admins can view search areas" on public.locator_search_areas_daily for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- the 0095 usage-counter table learns the third tab and a few more events
alter table public.locator_events_daily drop constraint if exists locator_events_daily_category_check;
alter table public.locator_events_daily add constraint locator_events_daily_category_check
  check (category in ('doctor', 'therapy', 'autism', 'none'));
alter table public.locator_events_daily drop constraint if exists locator_events_daily_event_check;
alter table public.locator_events_daily add constraint locator_events_daily_event_check
  check (event in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                   'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report'));
alter table public.locator_search_areas_daily drop constraint if exists locator_search_areas_daily_category_check;
alter table public.locator_search_areas_daily add constraint locator_search_areas_daily_category_check
  check (category in ('doctor', 'therapy', 'autism'));

-- ------------------------------------------------------------------------- reports
create table if not exists public.locator_reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.locator_places(id) on delete cascade,
  reason text not null check (reason in ('wrong_info', 'closed', 'not_autism_aware', 'fake', 'other')),
  note text check (note is null or char_length(note) <= 400),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists locator_reports_open_idx on public.locator_reports (status, created_at desc);
alter table public.locator_reports enable row level security;
revoke all on public.locator_reports from anon;
grant select, update, delete on public.locator_reports to authenticated;
drop policy if exists "Admins can view locator reports" on public.locator_reports;
create policy "Admins can view locator reports" on public.locator_reports for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));
drop policy if exists "Admins can update locator reports" on public.locator_reports;
create policy "Admins can update locator reports" on public.locator_reports for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));
drop policy if exists "Admins can delete locator reports" on public.locator_reports;
create policy "Admins can delete locator reports" on public.locator_reports for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------- phone code helper
create table if not exists public.locator_phone_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_today int not null default 0,
  sent_day date not null default current_date,
  last_sent timestamptz not null default now()
);
alter table public.locator_phone_codes enable row level security;
revoke all on public.locator_phone_codes from anon, authenticated;

create or replace function public.locator_code_issue(p_phone text, p_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare r public.locator_phone_codes%rowtype;
begin
  select * into r from public.locator_phone_codes where phone = p_phone;
  if found then
    if r.last_sent > now() - interval '45 seconds' then return 'too_soon'; end if;
    if r.sent_day = current_date and r.sent_today >= 5 then return 'too_many'; end if;
    update public.locator_phone_codes
      set code_hash = p_hash, expires_at = now() + interval '10 minutes', attempts = 0,
          sent_today = case when sent_day = current_date then sent_today + 1 else 1 end,
          sent_day = current_date, last_sent = now()
      where phone = p_phone;
  else
    insert into public.locator_phone_codes (phone, code_hash, expires_at) values (p_phone, p_hash, now() + interval '10 minutes');
  end if;
  return 'ok';
end;
$$;

create or replace function public.locator_code_check(p_phone text, p_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.locator_phone_codes%rowtype;
begin
  select * into r from public.locator_phone_codes where phone = p_phone for update;
  if not found or r.expires_at < now() or r.attempts >= 5 then return false; end if;
  if r.code_hash = p_hash then
    delete from public.locator_phone_codes where phone = p_phone;
    return true;
  end if;
  update public.locator_phone_codes set attempts = attempts + 1 where phone = p_phone;
  return false;
end;
$$;
revoke all on function public.locator_code_issue(text, text) from public, anon, authenticated;
revoke all on function public.locator_code_check(text, text) from public, anon, authenticated;
grant execute on function public.locator_code_issue(text, text) to service_role;
grant execute on function public.locator_code_check(text, text) to service_role;

-- ------------------------------------------------- usage counter (new tab + events)
create or replace function public.locator_event(p_event text, p_category text default 'none')
returns void language plpgsql security definer set search_path = public as $$
declare
  cat text := case when p_category in ('doctor', 'therapy', 'autism') then p_category else 'none' end;
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
revoke all on function public.locator_event(text, text) from public, anon, authenticated;
grant execute on function public.locator_event(text, text) to service_role;

-- ------------------------------------------------------------------ public search v2
-- Replaces the 0095 version (the result shape grew, so it is dropped and re-created).
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
  map_lat numeric, map_lng numeric, verified boolean, verified_on date, featured boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := least(greatest(coalesce(p_radius_km, 5), 1), 10);
begin
  if p_lat is null or p_lng is null then return; end if;
  if p_category not in ('doctor', 'therapy', 'autism') then return; end if;
  if not coalesce((select s.is_live from public.locator_settings s where s.id = 1), true) then return; end if;
  if p_lat not between 24.75 and 25.15 or p_lng not between 66.85 and 67.45 then return; end if;

  return query
  with hits as (
    select
      p.id, p.category, p.kind, p.name, p.area, p.address, p.phone, p.notes,
      p.doctor_id, p.orientation_date,
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
         (q.is_featured and q.frank <= 2)
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
    'therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now()),
    'autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism')
  );
$$;
revoke all on function public.locator_counts() from public;
grant execute on function public.locator_counts() to anon, authenticated, service_role;

-- ------------------------------------------------- public: fee list for the sign-up form
create or replace function public.locator_fee_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind, 'label', label, 'fee_pkr', fee_pkr, 'requires_verification', requires_verification
  ) order by sort_order), '[]'::jsonb)
  from public.locator_fees where accepts_applications;
$$;
revoke all on function public.locator_fee_list() from public;
grant execute on function public.locator_fee_list() to anon, authenticated, service_role;

-- ------------------------------------------- server-only: counters, reports, apply...
create or replace function public.locator_places_shown(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  insert into public.locator_place_events_daily (place_id, day, event, n)
  select x, d, 'shown', 1 from (select distinct unnest(p_ids[1:40]) as x) s
  where exists (select 1 from public.locator_places where id = s.x)
  on conflict (place_id, day, event) do update set n = public.locator_place_events_daily.n + 1;
end;
$$;

create or replace function public.locator_place_event(p_place uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_event not in ('directions', 'call', 'book') then return; end if;
  if not exists (select 1 from public.locator_places where id = p_place) then return; end if;
  insert into public.locator_place_events_daily (place_id, day, event, n) values (p_place, d, p_event, 1)
  on conflict (place_id, day, event) do update set n = public.locator_place_events_daily.n + 1;
end;
$$;

create or replace function public.locator_search_note(p_area text, p_category text, p_found boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_category not in ('doctor', 'therapy', 'autism') then return; end if;
  if p_area is null or char_length(btrim(p_area)) = 0 or char_length(p_area) > 80 then return; end if;
  insert into public.locator_search_areas_daily (day, area, category, searches, empty)
  values (d, btrim(p_area), p_category, 1, case when p_found then 0 else 1 end)
  on conflict (day, area, category) do update
    set searches = public.locator_search_areas_daily.searches + 1,
        empty = public.locator_search_areas_daily.empty + case when p_found then 0 else 1 end;
end;
$$;

-- the click target of the counted Directions link: exact pin, one place at a time
create or replace function public.locator_directions_target(p_place uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.locator_places%rowtype;
begin
  select * into r from public.locator_places
   where id = p_place and status = 'approved'
     and (category = 'autism' or (paid_until is not null and paid_until > now()));
  if not found then return null; end if;
  perform public.locator_place_event(p_place, 'directions');
  return jsonb_build_object('lat', r.lat, 'lng', r.lng, 'name', r.name, 'area', r.area);
end;
$$;

create or replace function public.locator_report(p_place uuid, p_reason text, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_reason not in ('wrong_info', 'closed', 'not_autism_aware', 'fake', 'other') then return false; end if;
  if not exists (select 1 from public.locator_places where id = p_place) then return false; end if;
  if (select count(*) from public.locator_reports where status = 'open') > 2000 then return false; end if;
  insert into public.locator_reports (place_id, reason, note) values (p_place, p_reason, nullif(btrim(coalesce(p_note, '')), ''));
  return true;
end;
$$;

-- A workplace application (clinic, hospital, lab, pharmacy, rehab, therapist...). Returns
-- jsonb {id, requires_verification, fee_pkr}. Verification-required types wait for an admin;
-- pharmacies are approved at once but only go live once the fee is paid.
create or replace function public.locator_apply_place(
  p_category text, p_kind text, p_name text, p_area text, p_address text, p_phone text,
  p_notes text, p_lat double precision, p_lng double precision,
  p_owner_name text, p_owner_phone text, p_owner_email text, p_registration text,
  p_phone_verified boolean, p_token_hash text, p_consent boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f public.locator_fees%rowtype;
  new_id uuid;
begin
  if p_consent is not true then raise exception 'consent_required'; end if;
  if p_category not in ('doctor', 'therapy') then raise exception 'bad_category'; end if;
  select * into f from public.locator_fees where kind = p_kind and accepts_applications;
  if not found then raise exception 'bad_kind'; end if;
  if (p_category = 'therapy') <> (p_kind in ('rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology')) then
    raise exception 'bad_kind';
  end if;
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
    phone_verified, manage_token_hash, verification_status
  ) values (
    p_category, p_kind, btrim(p_name), 'Karachi', btrim(p_area),
    nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), round(p_lat::numeric, 6), round(p_lng::numeric, 6),
    case when f.requires_verification then 'pending' else 'approved' end, 'owner',
    true, nullif(btrim(coalesce(p_owner_name, '')), ''), nullif(btrim(coalesce(p_owner_phone, '')), ''),
    nullif(btrim(coalesce(p_owner_email, '')), ''), nullif(btrim(coalesce(p_registration, '')), ''),
    coalesce(p_phone_verified, false), p_token_hash,
    case when f.requires_verification then 'pending' else 'not_required' end
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'requires_verification', f.requires_verification, 'fee_pkr', f.fee_pkr);
end;
$$;

create or replace function public.locator_attach_proof(p_place uuid, p_hash text, p_path text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.locator_places set proof_paths = proof_paths || p_path
   where id = p_place and manage_token_hash = p_hash and coalesce(array_length(proof_paths, 1), 0) < 6;
  return found;
end;
$$;

-- the owner's own page: status and what is needed next (statistics are admin-only)
create or replace function public.locator_manage_view(p_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.locator_places%rowtype;
  f public.locator_fees%rowtype;
begin
  if p_hash is null or char_length(p_hash) <> 64 then return null; end if;
  select * into p from public.locator_places where manage_token_hash = p_hash;
  if not found then return null; end if;
  select * into f from public.locator_fees where kind = p.kind;
  return jsonb_build_object(
    'id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'area', p.area,
    'status', p.status, 'verification_status', p.verification_status,
    'rejection_reason', p.rejection_reason, 'paid_until', p.paid_until,
    'fee_pkr', coalesce(f.fee_pkr, 0), 'requires_verification', coalesce(f.requires_verification, true),
    'live', (p.status = 'approved' and p.paid_until is not null and p.paid_until > now()),
    'phone_verified', p.phone_verified
    -- no view/tap numbers here on purpose: those are for the admin only
  );
end;
$$;

-- hash -> place id + what the checkout needs (server only)
create or replace function public.locator_checkout_info(p_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.locator_places%rowtype; f public.locator_fees%rowtype;
begin
  if p_hash is null or char_length(p_hash) <> 64 then return null; end if;
  select * into p from public.locator_places where manage_token_hash = p_hash;
  if not found then return null; end if;
  select * into f from public.locator_fees where kind = p.kind;
  return jsonb_build_object(
    'id', p.id, 'status', p.status, 'verification_status', p.verification_status,
    'requires_verification', coalesce(f.requires_verification, true), 'fee_pkr', coalesce(f.fee_pkr, 0),
    'paid_until', p.paid_until);
end;
$$;

-- Settles a succeeded payment: idempotent; new end = max(now, current end) + months.
create or replace function public.locator_settle_payment(p_payment uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare pay public.locator_payments%rowtype; base timestamptz;
begin
  select * into pay from public.locator_payments where id = p_payment for update;
  if not found or pay.status = 'succeeded' then return false; end if;
  update public.locator_payments
     set status = 'succeeded', paid_at = now(), updated_at = now(), raw_payload = p_payload,
         receipt_no = nextval('public.locator_receipt_seq')
   where id = p_payment;
  select greatest(now(), coalesce(paid_until, now())) into base from public.locator_places where id = pay.place_id;
  update public.locator_places set paid_until = base + make_interval(months => pay.months) where id = pay.place_id;
  perform public.locator_event('paid', (select category from public.locator_places where id = pay.place_id));
  return true;
end;
$$;

-- ------------------------------------------------------------ admin-only functions
create or replace function public.locator_admin_record_payment(
  p_place uuid, p_amount int, p_method text, p_reference text, p_note text, p_months int default 12
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid; rcpt int; base timestamptz; newend timestamptz;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_method not in ('cash', 'jazzcash', 'easypaisa', 'bank', 'complimentary', 'other') then raise exception 'bad_method'; end if;
  if p_amount is null or p_amount < 0 or (p_method <> 'complimentary' and p_amount = 0) then raise exception 'bad_amount'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'bad_months'; end if;
  if not exists (select 1 from public.locator_places where id = p_place) then raise exception 'no_place'; end if;
  rcpt := nextval('public.locator_receipt_seq');
  insert into public.locator_payments (place_id, amount, method, status, months, reference, note, receipt_no, recorded_by, paid_at)
  values (p_place, p_amount, p_method, 'succeeded', p_months, nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), rcpt, auth.uid(), now())
  returning id into pid;
  select greatest(now(), coalesce(paid_until, now())) into base from public.locator_places where id = p_place;
  newend := base + make_interval(months => p_months);
  update public.locator_places set paid_until = newend where id = p_place;
  return jsonb_build_object('payment_id', pid, 'receipt_no', rcpt, 'paid_until', newend);
end;
$$;

-- Makes (or re-makes) the owner's manage link. Returns the RAW token once; only a hash is kept.
create or replace function public.locator_admin_make_link(p_place uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.locator_places
     set manage_token_hash = encode(sha256(convert_to(tok, 'UTF8')), 'hex')
   where id = p_place;
  if not found then raise exception 'no_place'; end if;
  return tok;
end;
$$;

create or replace function public.locator_admin_verify(p_place uuid, p_decision text, p_notes text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'bad_decision'; end if;
  update public.locator_places set
    verification_status = p_decision,
    verification_notes = nullif(btrim(coalesce(p_notes, '')), ''),
    rejection_reason = case when p_decision = 'rejected' then nullif(btrim(coalesce(p_reason, '')), '') else null end,
    status = case when p_decision = 'verified' then 'approved' else 'hidden' end,
    reviewed_at = now()
  where id = p_place;
  if not found then raise exception 'no_place'; end if;
end;
$$;

create or replace function public.locator_admin_purge_drafts()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  delete from public.locator_places
   where source = 'owner' and paid_until is null and created_at < now() - interval '30 days'
     and not exists (select 1 from public.locator_payments x where x.place_id = locator_places.id and x.status = 'succeeded');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- richer admin summary (replaces the 0095 one; same name and shape plus more)
create or replace function public.locator_admin_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  return jsonb_build_object(
    'is_live', coalesce((select is_live from public.locator_settings where id = 1), true),
    'places', jsonb_build_object(
      'live_doctor', (select count(*) from public.locator_places where status = 'approved' and category = 'doctor' and paid_until > now()),
      'live_therapy', (select count(*) from public.locator_places where status = 'approved' and category = 'therapy' and paid_until > now()),
      'live_autism', (select count(*) from public.locator_places where status = 'approved' and category = 'autism'),
      'pending', (select count(*) from public.locator_places where status = 'pending'),
      'awaiting_payment', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','therapy') and (paid_until is null)),
      'expiring_30d', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','therapy') and paid_until > now() and paid_until < now() + interval '30 days'),
      'expired', (select count(*) from public.locator_places where status = 'approved' and category in ('doctor','therapy') and paid_until is not null and paid_until <= now()),
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

-- per-place stats for one place (admin)
create or replace function public.locator_admin_place_stats(p_place uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  return coalesce((select jsonb_object_agg(event, n) from (
    select event, sum(n)::bigint as n from public.locator_place_events_daily
    where place_id = p_place and day > d - 30 group by event) s), '{}'::jsonb);
end;
$$;

-- --------------------------------------------------------- private proof-file bucket
-- Licence / registration / signboard photos. Private: no policies are created for browsers,
-- so only the server (service role) reads or writes; admins open files through signed links.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('locator-proofs', 'locator-proofs', false, 3670016,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ----------------------------------------------------------------- grants for all
revoke all on function public.locator_places_shown(uuid[]) from public, anon, authenticated;
revoke all on function public.locator_place_event(uuid, text) from public, anon, authenticated;
revoke all on function public.locator_search_note(text, text, boolean) from public, anon, authenticated;
revoke all on function public.locator_directions_target(uuid) from public, anon, authenticated;
revoke all on function public.locator_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.locator_attach_proof(uuid, text, text) from public, anon, authenticated;
revoke all on function public.locator_manage_view(text) from public, anon, authenticated;
revoke all on function public.locator_checkout_info(text) from public, anon, authenticated;
revoke all on function public.locator_settle_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.locator_places_shown(uuid[]) to service_role;
grant execute on function public.locator_place_event(uuid, text) to service_role;
grant execute on function public.locator_search_note(text, text, boolean) to service_role;
grant execute on function public.locator_directions_target(uuid) to service_role;
grant execute on function public.locator_report(uuid, text, text) to service_role;
grant execute on function public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean) to service_role;
grant execute on function public.locator_attach_proof(uuid, text, text) to service_role;
grant execute on function public.locator_manage_view(text) to service_role;
grant execute on function public.locator_checkout_info(text) to service_role;
grant execute on function public.locator_settle_payment(uuid, jsonb) to service_role;

revoke all on function public.locator_admin_record_payment(uuid, int, text, text, text, int) from public, anon;
revoke all on function public.locator_admin_make_link(uuid) from public, anon;
revoke all on function public.locator_admin_verify(uuid, text, text, text) from public, anon;
revoke all on function public.locator_admin_purge_drafts() from public, anon;
revoke all on function public.locator_admin_summary() from public, anon;
revoke all on function public.locator_admin_place_stats(uuid) from public, anon;
grant execute on function public.locator_admin_record_payment(uuid, int, text, text, text, int) to authenticated;
grant execute on function public.locator_admin_make_link(uuid) to authenticated;
grant execute on function public.locator_admin_verify(uuid, text, text, text) to authenticated;
grant execute on function public.locator_admin_purge_drafts() to authenticated;
grant execute on function public.locator_admin_summary() to authenticated;
grant execute on function public.locator_admin_place_stats(uuid) to authenticated;

-- The admin's direct "Add a place" also needs the new columns writable: covered by the 0095
-- insert/update policies (admin only).
