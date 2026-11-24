-- Same real-data check as pg_locator_kc_test.sql, but with migration 0101 applied: the 49 rows (no vaccine_type column) must all become government.
-- Loads the cleaned Karachi Central sheet (49 centres, read by the same parser as the admin upload) through the real
-- import function: dry run, commit, public search, re-upload. Run after pg_locator_setup.sql, from the repo root.
\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
create table if not exists public.doctor_profiles (
  id uuid primary key, full_name text not null, verification_status text not null default 'approved',
  is_active boolean not null default true, subscription_status text not null default 'unpaid',
  subscription_current_period_end timestamptz);
grant select on public.doctor_profiles to authenticated, service_role;
\i supabase/migrations/0095_locator.sql
\i supabase/migrations/0096_locator_listings.sql
\i supabase/migrations/0097_locator_pharmacy_hours_doctor_clinics.sql
\i supabase/migrations/0098_locator_service_areas.sql
\i supabase/migrations/0099_locator_sindh_cities.sql
\i supabase/migrations/0100_locator_vaccination.sql
\i supabase/migrations/0101_locator_vaccine_type.sql
insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@x.test');
insert into admin_profiles(id, full_name) values ('11111111-1111-1111-1111-111111111111', 'Admin');
create table public._kc(j jsonb);
\set content `cat _t/fixtures/karachi-central-49-rows.json`
insert into public._kc values (:'content'::jsonb);
grant select on public._kc to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'K1 rows in file (expect 49)', jsonb_array_length(j) from _kc;
select 'K2 dry run (expect new 49, update 0, error 0, duplicate 0)', (locator_admin_vacc_import((select j from _kc), false, null))->'counts';
select 'K3 dry run saved nothing (expect 0)', count(*) from locator_places where category = 'vaccination';
select 'K4 commit (expect new 49)', (locator_admin_vacc_import((select j from _kc), true, 'Karachi Central 2026-11-24'))->'counts';
select 'K5 all live and in the city Karachi (expect 49, 49)', count(*), count(*) filter (where city = 'Karachi' and status = 'approved') from locator_places where category = 'vaccination';
select 'K6 first centre area, friday, saturday, sunday', area, hours->'days'->'fri', hours->'days'->'sat', hours->'days'->'sun' from locator_places where name = 'Mohammadi Centre';
select 'K7 re-upload the same sheet (expect new 0, update 49)', (locator_admin_vacc_import((select j from _kc), true, 'again'))->'counts';
select 'K8 still 49 centres, no copies (expect 49)', count(*) from locator_places where category = 'vaccination';
reset role;
set role anon;
select 'K9 public search near Nazimabad (expect > 0 rows, within 30 km)', count(*), round(min(distance_km)::numeric, 2) from locator_search(24.9300, 67.0700, 5, 'vaccination', null);
select 'K10 public search row shows UC + town and Friday hours', area, hours->'days'->'fri' from locator_search(24.9162, 67.0728, 3, 'vaccination', null) order by distance_km limit 1;
select 'K11 public counts (expect vaccination 49)', (locator_counts(null))->'vaccination';
