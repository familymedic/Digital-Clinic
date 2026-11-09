-- Test for migration 0095 (locator). Run: psql -f _t/pg_locator_setup.sql, then this file.
\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000a001','admin@x.com'),('00000000-0000-0000-0000-00000000b002','pat@x.com') on conflict do nothing;
insert into public.admin_profiles(id, full_name) values ('00000000-0000-0000-0000-00000000a001','Admin') on conflict do nothing;
\i supabase/migrations/0095_locator.sql
\i supabase/migrations/0095_locator.sql
\echo == admin adds places (Clifton ~24.8138,67.0300)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
insert into locator_places(category,kind,name,area,lat,lng,status,phone,notes,submitted_by_name) values
 ('doctor','clinic','Near Clinic','Clifton',24.8150,67.0310,'approved','0300-1111111','Evening OPD','Secret Volunteer'),
 ('doctor','clinic','Mid Clinic','Clifton',24.8400,67.0300,'approved',null,null,null),      -- ~3.9 km north
 ('doctor','clinic','Far Clinic','Gulshan',24.9215,67.0920,'approved',null,null,null),      -- ~13 km
 ('doctor','clinic','Pending Clinic','Clifton',24.8140,67.0300,'pending',null,null,null),
 ('doctor','clinic','Hidden Clinic','Clifton',24.8141,67.0301,'hidden',null,null,null),
 ('autism','barber','Calm Cuts','Clifton',24.8160,67.0320,'approved',null,'Quiet hours Tue-Thu',null),
 ('autism','restaurant','Soft Table','Gulshan',24.9215,67.0925,'approved',null,null,null);
select 'AD1 admin sees all places', count(*) from locator_places;
reset role;

\echo == public search (anon)
set role anon;
select 'S1 5km doctors', string_agg(name || ':' || distance_km, ', ' order by distance_km) from locator_search(24.8138,67.0300,5,'doctor');
select 'S2 2km doctors', string_agg(name, ',' order by distance_km) from locator_search(24.8138,67.0300,2,'doctor');
select 'S3 3km (Mid at ~3.9 excluded)', string_agg(name, ',' order by distance_km) from locator_search(24.8138,67.0300,3,'doctor');
select 'S4 autism 5km', string_agg(name, ',') from locator_search(24.8138,67.0300,5,'autism');
select 'S5 kind filter barber', count(*) from locator_search(24.8138,67.0300,5,'autism','barber');
select 'S6 kind filter restaurant (none nearby)', count(*) from locator_search(24.8138,67.0300,5,'autism','restaurant');
select 'S7 pending/hidden never shown', count(*) from locator_search(24.8138,67.0300,10,'doctor') where name in ('Pending Clinic','Hidden Clinic');
select 'S8 outside Karachi (Lahore) empty', count(*) from locator_search(31.5204,74.3587,5,'doctor');
select 'S9 null coords empty', count(*) from locator_search(null,null,5,'doctor');
select 'S10 bad category empty', count(*) from locator_search(24.8138,67.0300,5,'x');
select 'S11 radius clamp to 10 (Far at ~13 still out)', count(*) from locator_search(24.8138,67.0300,999,'doctor') where name='Far Clinic';
select 'S13 phone/notes returned', phone, notes from locator_search(24.8138,67.0300,2,'doctor') where name='Near Clinic';
select 'S14 counts', locator_counts();
select 'S15 anon cannot read places table'; select count(*) from locator_places;
select 'S16 anon cannot read waitlist'; select count(*) from locator_waitlist;
select 'S17 anon cannot call event'; select locator_event('search','doctor');
select 'S18 anon cannot submit'; select locator_submit_place('doctor','clinic','X Clinic','Clifton',null,null,null,24.81,67.03,null,null,true);
select 'S19 anon cannot waitlist'; select locator_waitlist_add('Lahore','0300-1234567','both');
select 'S20 anon cannot admin summary'; select locator_admin_summary();
select 'S21 anon reads settings', is_live from locator_settings;
reset role;

\echo == patient (logged in, not admin)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b002',false);
select 'P1 patient sees 0 places', count(*) from locator_places;
select 'P2 patient cannot insert'; insert into locator_places(category,kind,name,area,lat,lng) values ('doctor','clinic','Sneaky','Clifton',24.8,67.0);
select 'P3 patient search works', count(*) from locator_search(24.8138,67.0300,5,'doctor');
select 'P4 patient cannot summary'; select locator_admin_summary();
select 'P5 patient cannot switch off'; update locator_settings set is_live=false; select 'P5b still live', is_live from locator_settings;
reset role;

\echo == server (service_role) writes
set role service_role;
select 'W1 event ok'; select locator_event('search','doctor'); select locator_event('search','doctor'); select locator_event('call_tap','autism'); select locator_event('bogus','doctor'); select locator_event('search','weird');
select 'W1b counts', event, category, n from locator_events_daily order by event, category;
select 'W2 waitlist ok', locator_waitlist_add('Lahore','0300-1234567','doctor');
select 'W2b duplicate merges', locator_waitlist_add('lahore','0300-1234567','both');
select 'W2c count', count(*) from locator_waitlist;
select 'W3 bad contact', locator_waitlist_add('Lahore','abc12','both');
select 'W3b email ok', locator_waitlist_add('Multan','a@b.pk','autism');
select 'W4 submit ok (pending)'; select locator_submit_place('autism','barber','New Barber','Clifton','Shop 4','0321-1234567','Staff oriented',24.8200,67.0350,'Vol A','0300-0000000',true) is not null;
select 'W5 no consent'; select locator_submit_place('autism','barber','No Consent','Clifton',null,null,null,24.82,67.035,null,null,false);
select 'W6 outside Karachi'; select locator_submit_place('autism','barber','Lahore Barber','Gulberg',null,null,null,31.52,74.35,null,null,true);
select 'W7 duplicate returns null', locator_submit_place('autism','barber','new barber','Clifton',null,null,null,24.8201,67.0351,null,null,true) is null;
select 'W8 bad kind rejected'; select locator_submit_place('autism','dragon','Bad Kind','Clifton',null,null,null,24.83,67.04,null,null,true);
reset role;
select 'W9 submitted row is pending + private fields kept', status, source, submitted_by_name from locator_places where name='New Barber';
set role anon; select 'W10 pending barber not public', count(*) from locator_search(24.8138,67.0300,5,'autism') where name='New Barber'; reset role;

\echo == admin summary, approve, switch off
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'M1 summary', locator_admin_summary();
update locator_places set status='approved', reviewed_at=now() where name='New Barber';
select 'M2 approved'; select count(*) from locator_search(24.8138,67.0300,5,'autism') where name='New Barber';
update locator_settings set is_live=false, updated_at=now();
select 'M3 off => empty', count(*) from locator_search(24.8138,67.0300,5,'doctor');
update locator_settings set is_live=true;
select 'M4 on again', count(*) from locator_search(24.8138,67.0300,5,'doctor');
delete from locator_waitlist where lower(city)='multan';
select 'M5 waitlist now', count(*) from locator_waitlist;
reset role;
\echo == rollback
\i supabase/migrations/ROLLBACK-0095.sql
select 'R tables left', count(*) from information_schema.tables where table_name like 'locator_%';
\i supabase/migrations/0095_locator.sql
select 'R reapply ok', count(*) from information_schema.tables where table_name like 'locator_%';
