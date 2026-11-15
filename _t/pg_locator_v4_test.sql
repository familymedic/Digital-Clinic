-- Test for migration 0099 (Sindh cities, just-opened flag, 30 km search, widen event).
-- Run: psql -f _t/pg_locator_setup.sql, then this file (from the repo root).
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
-- places that exist BEFORE 0099 (a Jamshoro-side pin was labelled Hyderabad by 0098)
insert into locator_places(category,kind,name,area,lat,lng,status,paid_until) values
 ('doctor','clinic','Jamshoro Clinic','Jamshoro',25.4296,68.28,'approved', now() + interval '6 months'),
 ('doctor','clinic','Kotri Clinic','Kotri',25.3667,68.3167,'approved', now() + interval '6 months'),
 ('doctor','clinic','Karachi Clinic','Clifton',24.8138,67.03,'approved', now() + interval '6 months');
\i supabase/migrations/0099_locator_sindh_cities.sql
\i supabase/migrations/0099_locator_sindh_cities.sql

\echo == regions
select 'X1 six cities (expect 6)', count(*) from locator_regions;
select 'X2 city_for Sukkur (expect Sukkur)', locator_city_for(27.7052, 68.8574);
select 'X3 city_for Khairpur (expect Khairpur)', locator_city_for(27.5295, 68.7592);
select 'X4 city_for Larkana (expect Larkana)', locator_city_for(27.557, 68.2141);
select 'X5 city_for Jamshoro (expect Jamshoro)', locator_city_for(25.4296, 68.28);
select 'X6 city_for Kotri stays Hyderabad (expect Hyderabad)', locator_city_for(25.3667, 68.3167);
select 'X7 city_for Hyderabad centre (expect Hyderabad)', locator_city_for(25.3792, 68.3683);
select 'X8 DHA City / Bahria are Karachi (expect Karachi,Karachi)', locator_city_for(25.06, 67.29), locator_city_for(25.0, 67.317);
select 'X9 Lahore is outside (expect null)', locator_city_for(31.52, 74.35) is null;
select 'X10 Jamshoro clinic relabelled (expect Jamshoro)', city from locator_places where name = 'Jamshoro Clinic';
select 'X11 Kotri clinic stays Hyderabad (expect Hyderabad)', city from locator_places where name = 'Kotri Clinic';
select 'X12 Karachi clinic unchanged (expect Karachi)', city from locator_places where name = 'Karachi Clinic';
select 'X13 rerun added no duplicate regions (expect 6)', count(distinct city) from locator_regions;

\echo == just opened
select 'Y1 Karachi never just-opened (expect f)', (e->>'just_opened')::boolean from jsonb_array_elements(locator_regions_public()) e where e->>'city' = 'Karachi';
select 'Y2 Sukkur just-opened (expect t)', (e->>'just_opened')::boolean from jsonb_array_elements(locator_regions_public()) e where e->>'city' = 'Sukkur';
select 'Y3 Hyderabad just-opened (expect t)', (e->>'just_opened')::boolean from jsonb_array_elements(locator_regions_public()) e where e->>'city' = 'Hyderabad';
update locator_regions set min_places = 1 where city = 'Jamshoro';
select 'Y4 Jamshoro has 1 visible place, min 1 -> not just-opened (expect f)', (e->>'just_opened')::boolean from jsonb_array_elements(locator_regions_public()) e where e->>'city' = 'Jamshoro';
select 'Y5 regions_public readable by anon (expect t)', has_function_privilege('anon', 'public.locator_regions_public()', 'execute');

\echo == 30 km search
insert into locator_places(category,kind,name,area,lat,lng,status,paid_until) values
 ('doctor','hospital','Far Hospital','Sukkur',27.7052,68.8574,'approved', now() + interval '6 months'),
 ('doctor','clinic','Sukkur Clinic 25km','Rohri side',27.70,69.08,'approved', now() + interval '6 months');
select 'Z1 a clinic about 20 km from Sukkur centre is found at 30 km (expect 1)', count(*) from locator_search(27.7052, 68.8574, 30, 'doctor', 'clinic');
select 'Z1b ... and not at 10 km (expect 0)', count(*) from locator_search(27.7052, 68.8574, 10, 'doctor', 'clinic');
insert into locator_places(category,kind,name,area,lat,lng,status,paid_until) values
 ('doctor','clinic','Karachi Far Clinic','Gadap',25.0,67.18,'approved', now() + interval '6 months');
select 'Z2 Clifton search at 10 km misses the Gadap clinic (expect 0)', count(*) from locator_search(24.8138, 67.03, 10, 'doctor', 'clinic') where name = 'Karachi Far Clinic';
select 'Z3 Gadap clinic is about 25 km away: not found at 20 km (expect 0), found at 30 km (expect 1)', (select count(*) from locator_search(24.8138, 67.03, 20, 'doctor', 'clinic') where name = 'Karachi Far Clinic'), (select count(*) from locator_search(24.8138, 67.03, 30, 'doctor', 'clinic') where name = 'Karachi Far Clinic');
select 'Z4 radius is capped at 30 km (expect 1 for 99 km ask)', count(*) from locator_search(24.8138, 67.03, 99, 'doctor', 'clinic') where name = 'Karachi Far Clinic';
select 'Z5 Sukkur hospital found in Sukkur (expect 1)', count(*) from locator_search(27.7052, 68.8574, 3, 'doctor', 'hospital');
select 'Z6 search outside every city returns nothing (expect 0)', count(*) from locator_search(31.52, 74.35, 30, 'doctor', null);

\echo == widen event
select locator_event('widen', 'pharmacy');
select 'W1 widen counted (expect 1)', n from locator_events_daily where event = 'widen' and category = 'pharmacy';
select locator_event('nonsense', 'pharmacy');
select 'W2 unknown events still ignored (expect 0)', count(*) from locator_events_daily where event = 'nonsense';

\echo == rollback
\i supabase/migrations/ROLLBACK-0099.sql
select 'R1 regions back to 2 (expect 2)', count(*) from locator_regions;
select 'R2 Jamshoro clinic back to Hyderabad (expect Hyderabad)', city from locator_places where name = 'Jamshoro Clinic';
select 'R3 search radius capped at 10 again (expect 0)', count(*) from locator_search(24.8138, 67.03, 99, 'doctor', 'clinic') where name = 'Karachi Far Clinic';
select 'R4 widen event gone (expect 0)', count(*) from locator_events_daily where event = 'widen';
\i supabase/migrations/0099_locator_sindh_cities.sql
select 'R5 reapply works (expect 6)', count(*) from locator_regions;
