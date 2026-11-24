-- Test for migration 0100 (vaccination centres: free listing, admin import / update / undo, share event).
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
\i supabase/migrations/0099_locator_sindh_cities.sql
\i supabase/migrations/0100_locator_vaccination.sql
\i supabase/migrations/0100_locator_vaccination.sql

insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@x.test'), ('22222222-2222-2222-2222-222222222222', 'user@x.test');
insert into admin_profiles(id, full_name) values ('11111111-1111-1111-1111-111111111111', 'Admin');

\echo == schema
select 'A1 new columns exist (expect 5)', count(*) from information_schema.columns where table_name = 'locator_places' and column_name in ('district','vaccines','source_note','last_verified','import_batch');
select 'A2 kind and category must match (expect t)', (select count(*) = 0 from locator_places where (kind = 'vaccination') <> (category = 'vaccination'));
insert into locator_places(category,kind,name,area,lat,lng,status) values ('doctor','vaccination','Bad','Xyz',24.9,67.0,'approved');
select 'A3 vaccination kind inside doctor category rejected (expect 0)', count(*) from locator_places where name = 'Bad';

\echo == admin only
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select 'B1 non-admin import refused', locator_admin_vacc_import('[{"name":"Hack Centre","area":"X","lat":24.9,"lng":67.0}]'::jsonb, true, 'x');
select 'B2 non-admin update refused', locator_admin_vacc_update(gen_random_uuid(), '{}'::jsonb);
select 'B3 non-admin undo refused', locator_admin_vacc_undo(gen_random_uuid());
select 'B4 checker not callable by users (expect f)', has_function_privilege('authenticated', 'public.locator_vacc_check(jsonb)', 'execute');
select 'B5 anon cannot import (expect f)', has_function_privilege('anon', 'public.locator_admin_vacc_import(jsonb,boolean,text)', 'execute');
reset role;
select 'B6 nothing was added (expect 0)', count(*) from locator_places where category = 'vaccination';

\echo == dry run
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'C1 dry run counts (expect new 3, update 0, error 4, duplicate 1)', locator_admin_vacc_import($j$[
 {"name":"Sample Health Centre A","area":"Gulshan-e-Iqbal","district":"Karachi East","lat":24.9215,"lng":67.0928,"phone":"021-111","vaccines":"Routine EPI","hours":{"days":{"mon":[["09:00","14:00"]],"tue":[["09:00","14:00"]],"wed":[["09:00","14:00"]],"thu":[["09:00","14:00"]],"fri":[["09:00","14:00"]],"sat":[["09:00","14:00"]]}}},
 {"name":"Sample Government Hospital B","area":"Nazimabad","district":"Karachi Central","lat":24.9136,"lng":67.0301,"hours":{"always":true}},
 {"name":"Sukkur BHU","area":"Sukkur","lat":27.7052,"lng":68.8574},
 {"name":"Sample Health Centre A","area":"Gulshan-e-Iqbal","lat":24.9215,"lng":67.0928},
 {"name":"No Pin Centre","area":"Liaquatabad"},
 {"name":"Lahore Centre","area":"Lahore","lat":31.52,"lng":74.35},
 {"name":"Bad Hours Centre","area":"Saddar","lat":24.86,"lng":67.01,"hours":{"days":{"mon":[["9am","2pm"]]}}},
 {"name":"","area":"Saddar","lat":24.86,"lng":67.01}
]$j$::jsonb, false, null)->'counts';
reset role;
select 'C2 dry run saved nothing (expect 0)', count(*) from locator_places where category = 'vaccination';
select 'C3 dry run made no batch (expect 0)', count(*) from locator_import_batches;

\echo == commit
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
create temp table res as select locator_admin_vacc_import($j$[
 {"name":"Sample Health Centre A","area":"Gulshan-e-Iqbal","district":"Karachi East","lat":24.9215,"lng":67.0928,"phone":"021-111","vaccines":"Routine EPI, birth to 15 months","source_note":"District list 2026","last_verified":"2026-11-20","notes":"EPI fixed centre","hours":{"days":{"mon":[["09:00","14:00"]],"sat":[["09:00","14:00"]]}}},
 {"name":"Sample Government Hospital B","area":"Nazimabad","district":"Karachi Central","lat":24.9136,"lng":67.0301,"hours":{"always":true}},
 {"name":"Sukkur BHU","area":"Sukkur","lat":27.7052,"lng":68.8574},
 {"name":"No Pin Centre","area":"Liaquatabad"}
]$j$::jsonb, true, 'Karachi Central list') as j;
reset role;
select 'D1 three centres added, one skipped (expect 3)', count(*) from locator_places where category = 'vaccination';
select 'D2 they are public at once with no payment (expect 3 approved, 0 with paid_until)', count(*) filter (where status = 'approved'), count(*) filter (where paid_until is not null) from locator_places where category = 'vaccination';
select 'D3 city comes from the pin (expect Karachi,Karachi,Sukkur)', string_agg(city, ',' order by name) from locator_places where category = 'vaccination';
select 'D4 batch recorded (expect 3,0,1)', rows_added, rows_updated, rows_skipped from locator_import_batches;
select 'D5 fields saved (expect Routine EPI, birth to 15 months | District list 2026 | 2026-11-20 | Karachi East)', vaccines, source_note, last_verified, district from locator_places where name = 'Sample Health Centre A';
select 'D6 last_verified defaults to today when blank (expect t)', last_verified = (now() at time zone 'Asia/Karachi')::date from locator_places where name = 'Sukkur BHU';

\echo == public search and counts
select 'E1 search finds the Gulshan centre without payment (expect 1)', count(*) from locator_search(24.9215, 67.0928, 5, 'vaccination', null);
select 'E2 search returns the new fields (expect Routine EPI, birth to 15 months | District list 2026)', vaccines, source_note from locator_search(24.9215, 67.0928, 1, 'vaccination', null) where name = 'Sample Health Centre A';
select 'E3 Sukkur centre found from Sukkur (expect 1)', count(*) from locator_search(27.7052, 68.8574, 3, 'vaccination', null);
select 'E4 doctors search does not show vaccination (expect 0)', count(*) from locator_search(24.9215, 67.0928, 10, 'doctor', null) where kind = 'vaccination';
select 'E5 counts include vaccination (expect 3; Karachi 2)', locator_counts()->>'vaccination', locator_counts('Karachi')->>'vaccination';
update locator_places set status = 'hidden' where name = 'Sample Government Hospital B';
select 'E6 a hidden centre is not public (expect 0)', count(*) from locator_search(24.9136, 67.0301, 1, 'vaccination', null) where name = 'Sample Government Hospital B';
select 'E7 counts drop the hidden one (expect 2)', locator_counts()->>'vaccination';
update locator_places set status = 'approved' where name = 'Sample Government Hospital B';

\echo == directions + share
select 'F1 counted directions target works (expect t)', (locator_directions_target(id)->>'lat') is not null from locator_places where name = 'Sample Health Centre A';
select 'F2 ...and counted a directions event (expect 1)', coalesce(sum(n), 0) from locator_place_events_daily where event = 'directions';
select 'F3 quiet target works without counting (expect t, then still 1)', (locator_directions_target_quiet(id)->>'lat') is not null, (select coalesce(sum(n), 0) from locator_place_events_daily where event = 'directions') from locator_places where name = 'Sample Health Centre A';
select locator_event('share', 'vaccination');
select 'F4 share event counted under vaccination (expect 1)', n from locator_events_daily where event = 'share' and category = 'vaccination';
select locator_event('share', 'doctor');
select 'F5 share works for any tab (expect 2 rows)', count(*) from locator_events_daily where event = 'share';
select locator_search_note('Gulshan-e-Iqbal', 'vaccination', true);
select 'F6 area counter accepts vaccination (expect 1)', count(*) from locator_search_areas_daily where category = 'vaccination';
select 'F7 anon may not read the table directly (expect f)', has_table_privilege('anon', 'public.locator_places', 'select');

\echo == re-upload updates, does not duplicate
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'G1 re-upload with a new phone (expect new 0, update 1)', locator_admin_vacc_import('[{"name":"sample health centre a","area":"Gulshan-e-Iqbal","lat":24.9216,"lng":67.0929,"phone":"021-999","vaccines":"Routine EPI"}]'::jsonb, true, 'Second sheet')->'counts';
reset role;
select 'G2 still 3 centres (expect 3)', count(*) from locator_places where category = 'vaccination';
select 'G3 phone updated, status kept (expect 021-999 | approved)', phone, status from locator_places where name = 'Sample Health Centre A';
select 'G4 hours cleared when the row has none (expect null)', hours from locator_places where name = 'Sample Health Centre A';

\echo == edit one
insert into locator_places(category,kind,name,area,lat,lng,status,paid_until) values ('doctor','clinic','Some Clinic','Clifton',24.8138,67.03,'approved', now() + interval '3 months');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'H1 edit one centre', locator_admin_vacc_update(id, '{"name":"Sample Health Centre A (Annex)","area":"Gulshan-e-Iqbal","lat":24.9216,"lng":67.0929,"hours":{"always":true}}'::jsonb) from locator_places where name = 'Sample Health Centre A';
select 'H2 edit with a bad pin is refused', locator_admin_vacc_update(id, '{"name":"Sample Health Centre A","area":"Xyz","lat":31.5,"lng":74.3}'::jsonb) from locator_places where name like 'Sample Health Centre A%';
select 'H3 editing a non-vaccination place is refused', locator_admin_vacc_update(id, '{"name":"Yy","area":"Xyz","lat":24.9,"lng":67.0}'::jsonb) from locator_places where category = 'doctor' limit 1;
reset role;
select 'H4 edit saved, hours now 24 h (expect Sample Health Centre A (Annex) | {"always": true})', name, hours from locator_places where name like 'Sample Health Centre A%';

\echo == undo
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'I1 undo the first upload removes only what it added (expect 3)', locator_admin_vacc_undo((select id from locator_import_batches where label = 'Karachi Central list'));
reset role;
select 'I2 nothing left (expect 0)', count(*) from locator_places where category = 'vaccination';
select 'I3 batch marked undone (expect t)', undone_at is not null from locator_import_batches where label = 'Karachi Central list';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'I4 undo twice is refused', locator_admin_vacc_undo((select id from locator_import_batches where label = 'Karachi Central list'));
reset role;

\echo == limits
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'J1 empty upload refused', locator_admin_vacc_import('[]'::jsonb, false, null);
select 'J2 not an array refused', locator_admin_vacc_import('{"a":1}'::jsonb, false, null);
reset role;

\echo == rollback and reapply
\i supabase/migrations/ROLLBACK-0100.sql
select 'K1 columns gone (expect 0)', count(*) from information_schema.columns where table_name = 'locator_places' and column_name in ('district','vaccines','source_note','last_verified','import_batch');
select 'K2 batch table gone (expect 0)', count(*) from information_schema.tables where table_name = 'locator_import_batches';
\i supabase/migrations/0096_locator_listings.sql
\i supabase/migrations/0097_locator_pharmacy_hours_doctor_clinics.sql
\i supabase/migrations/0098_locator_service_areas.sql
\i supabase/migrations/0099_locator_sindh_cities.sql
select 'K3 old search works again (expect 0 rows, no error)', count(*) from locator_search(24.9215, 67.0928, 5, 'doctor', null);
\i supabase/migrations/0100_locator_vaccination.sql
select 'K4 reapply works (expect 0)', count(*) from locator_search(24.9215, 67.0928, 5, 'vaccination', null);
