-- Test for migration 0101 (vaccine type + service fee). Run after pg_locator_setup.sql, from the repo root.
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
insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@x.test'), ('22222222-2222-2222-2222-222222222222', 'user@x.test');
insert into admin_profiles(id, full_name) values ('11111111-1111-1111-1111-111111111111', 'Admin');

\echo == centres added with the OLD (0100) functions, before 0101 exists
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'A1 two centres added under 0100 (expect new 2)', (locator_admin_vacc_import('[
 {"name":"Old Centre One","area":"Nazimabad","lat":24.91,"lng":67.03},
 {"name":"Old Centre Two","area":"Gulberg","lat":24.93,"lng":67.07}]'::jsonb, true, 'old'))->'counts';
reset role;
\i supabase/migrations/0101_locator_vaccine_type.sql
\i supabase/migrations/0101_locator_vaccine_type.sql
select 'B1 existing centres became government (expect 2, 2)', count(*), count(*) filter (where vaccine_type = 'government') from locator_places where category = 'vaccination';
select 'B2 service fee off by default (expect 0)', count(*) from locator_places where service_fee;
select 'B3 other categories have no vaccine type (expect t)', not exists (select 1 from locator_places where category <> 'vaccination' and vaccine_type is not null);
insert into locator_places(category,kind,name,area,lat,lng,status,vaccine_type) values ('vaccination','vaccination','Bad no type','Xyz',24.9,67.0,'approved',null);
select 'B4 vaccination centre without a type rejected (expect 0)', count(*) from locator_places where name = 'Bad no type';
insert into locator_places(category,kind,name,area,lat,lng,status,vaccine_type) values ('doctor','clinic','Doc with type','Xyz',24.9,67.0,'approved','private');
select 'B5 doctor place with a vaccine type rejected (expect 0)', count(*) from locator_places where name = 'Doc with type';
insert into locator_places(category,kind,name,area,lat,lng,status,vaccine_type) values ('vaccination','vaccination','Bad value','Xyz',24.9,67.0,'approved','free');
select 'B6 unknown vaccine type rejected (expect 0)', count(*) from locator_places where name = 'Bad value';

\echo == import with the new fields
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'C1 dry run: gov, private, both+fee, empty type, bad type (expect new 3, error 2)', (locator_admin_vacc_import('[
 {"name":"Gov Dispensary","area":"Nazimabad","lat":24.915,"lng":67.035,"vaccine_type":"government"},
 {"name":"Care Private Clinic","area":"Clifton","lat":24.82,"lng":67.03,"vaccine_type":"private","vaccines":"Typhoid, HPV, Flu"},
 {"name":"Both Hospital","area":"North Nazimabad","lat":24.95,"lng":67.06,"vaccine_type":"both","service_fee":true},
 {"name":"Empty Type","area":"Nazimabad","lat":24.915,"lng":67.04,"vaccine_type":""},
 {"name":"Bad Type","area":"Nazimabad","lat":24.915,"lng":67.045,"vaccine_type":"free"}]'::jsonb, false, null))->'counts';
select 'C2 reasons for the two problem rows', string_agg(x->>'reason', ','), count(*) from jsonb_array_elements((locator_admin_vacc_import('[
 {"name":"Empty Type","area":"Nazimabad","lat":24.915,"lng":67.04,"vaccine_type":""},
 {"name":"Bad Type","area":"Nazimabad","lat":24.915,"lng":67.045,"vaccine_type":"free"}]'::jsonb, false, null))->'results') x;
select 'C3 commit (expect new 3)', (locator_admin_vacc_import('[
 {"name":"Gov Dispensary","area":"Nazimabad","lat":24.915,"lng":67.035,"vaccine_type":"government"},
 {"name":"Care Private Clinic","area":"Clifton","lat":24.82,"lng":67.03,"vaccine_type":"private","vaccines":"Typhoid, HPV, Flu"},
 {"name":"Both Hospital","area":"North Nazimabad","lat":24.95,"lng":67.06,"vaccine_type":"both","service_fee":true}]'::jsonb, true, 'new types'))->'counts';
select 'C4 a row with no vaccine_type key counts as government (expect government)', (locator_admin_vacc_import('[{"name":"Old Style Row","area":"Gulberg","lat":24.94,"lng":67.08}]'::jsonb, true, null)) is not null, (select vaccine_type from locator_places where name = 'Old Style Row');
select 'C5 service fee stored only where yes (expect 1)', count(*) from locator_places where service_fee;
select 'C6 re-upload updates type and fee, no copy (expect update 1)', (locator_admin_vacc_import('[{"name":"Care Private Clinic","area":"Clifton","lat":24.82,"lng":67.03,"vaccine_type":"both","service_fee":true}]'::jsonb, true, null))->'counts';
select 'C7 now both + fee (expect both, t)', vaccine_type, service_fee from locator_places where name = 'Care Private Clinic';
select 'C8 put it back to private for the next checks', (locator_admin_vacc_import('[{"name":"Care Private Clinic","area":"Clifton","lat":24.82,"lng":67.03,"vaccine_type":"private","service_fee":false}]'::jsonb, true, null))->'counts'->'update';
select 'C9 edit one centre with the update function (expect ok)', (locator_admin_vacc_update((select id from locator_places where name = 'Gov Dispensary'), '{"name":"Gov Dispensary","area":"Nazimabad","lat":24.915,"lng":67.035,"vaccine_type":"government","service_fee":true}'::jsonb))->>'ok';
select 'C10 and fee is stored (expect t)', service_fee from locator_places where name = 'Gov Dispensary';
select 'C11 update with a bad type is refused (expect error text)', (select 1) ;
select locator_admin_vacc_update((select id from locator_places where name = 'Gov Dispensary'), '{"name":"Gov Dispensary","area":"Nazimabad","lat":24.915,"lng":67.035,"vaccine_type":"cheap"}'::jsonb);
select 'C12 undo removes the batch (expect 3)', locator_admin_vacc_undo((select id from locator_import_batches where label = 'new types'));
-- put them back for the public checks
select 'C13 re-add (expect new 3)', (locator_admin_vacc_import('[
 {"name":"Care Private Clinic","area":"Clifton","lat":24.82,"lng":67.03,"vaccine_type":"private","vaccines":"Typhoid, HPV, Flu"},
 {"name":"Both Hospital","area":"North Nazimabad","lat":24.95,"lng":67.06,"vaccine_type":"both","service_fee":true},
 {"name":"Gov Dispensary","area":"Nazimabad","lat":24.915,"lng":67.035,"vaccine_type":"government","service_fee":true}]'::jsonb, true, 'again'))->'counts';
reset role;
set role anon;
select 'D1 anon cannot import (expect error)', 1;
select locator_admin_vacc_import('[{"name":"X","area":"Y","lat":24.9,"lng":67}]'::jsonb, true, null);
reset role;

\echo == public search
set role anon;
select 'E1 first view = government + both (expect 5 names)', count(*), string_agg(name, ', ' order by name) from locator_search(24.93, 67.05, 30, 'vaccination', null);
select 'E2 private-only centre is NOT in the first view (expect 0)', count(*) from locator_search(24.93, 67.05, 30, 'vaccination', null) where name = 'Care Private Clinic';
select 'E3 private filter = private + both (expect Both Hospital, Care Private Clinic)', string_agg(name, ', ' order by name) from locator_search(24.93, 67.05, 30, 'vaccination', 'private');
select 'E4 government-only centre is not in the private filter (expect 0)', count(*) from locator_search(24.93, 67.05, 30, 'vaccination', 'private') where name = 'Gov Dispensary';
select 'E5 p_kind government behaves like the first view (expect 5)', count(*) from locator_search(24.93, 67.05, 30, 'vaccination', 'government');
select 'E6 new columns returned: type, fee', name, vaccine_type, service_fee from locator_search(24.93, 67.05, 30, 'vaccination', 'private') order by name;
select 'E7 doctor search unaffected by p_kind rules (expect 0 rows, no error)', count(*) from locator_search(24.93, 67.05, 5, 'doctor', 'clinic');
select 'E8 counts: vaccination first view 5, private 2', (locator_counts(null))->'vaccination', (locator_counts(null))->'vaccination_private';
reset role;
set role anon;
select 'E9 (placeholder, see E10)', 1;
reset role;
update locator_places set status = 'hidden' where name = 'Both Hospital';
set role anon;
select 'E10 after hiding Both Hospital: first view 4, private view 1', (select count(*) from locator_search(24.93, 67.05, 30, 'vaccination', null)), (select count(*) from locator_search(24.93, 67.05, 30, 'vaccination', 'private'));
reset role;
update locator_places set status = 'approved' where name = 'Both Hospital';

\echo == rollback and re-apply
\i supabase/migrations/ROLLBACK-0101.sql
\i supabase/migrations/0100_locator_vaccination.sql
select 'K1 private-only centre removed, the other 5 stay (expect 5)', count(*) from locator_places where category = 'vaccination';
select 'K2 columns gone (expect 0)', count(*) from information_schema.columns where table_name = 'locator_places' and column_name in ('vaccine_type', 'service_fee');
set role anon;
select 'K3 old search works again (expect 5 rows, no error)', count(*) from locator_search(24.93, 67.05, 30, 'vaccination', null);
reset role;
\i supabase/migrations/0101_locator_vaccine_type.sql
select 'K4 reapply: everything government again (expect 5, 5)', count(*), count(*) filter (where vaccine_type = 'government') from locator_places where category = 'vaccination';
