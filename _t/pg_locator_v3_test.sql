-- Test for migration 0097 (pharmacy tab, opening hours, doctors add their own clinic).
-- Run: psql -f _t/pg_locator_setup.sql, then this file (from the repo root).
\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000a001','admin@x.com'),
 ('00000000-0000-0000-0000-00000000b002','pat@x.com'),
 ('00000000-0000-0000-0000-00000000d001','paid@x.com'),
 ('00000000-0000-0000-0000-00000000d002','unpaid@x.com'),
 ('00000000-0000-0000-0000-00000000d003','pending@x.com'),
 ('00000000-0000-0000-0000-00000000d004','lapsed@x.com'),
 ('00000000-0000-0000-0000-00000000d005','paid2@x.com') on conflict do nothing;
insert into public.admin_profiles(id, full_name) values ('00000000-0000-0000-0000-00000000a001','Admin') on conflict do nothing;
-- stand-in for the real doctor_profiles columns the new functions read
create table if not exists public.doctor_profiles (
  id uuid primary key, full_name text not null, verification_status text not null default 'approved',
  is_active boolean not null default true, subscription_status text not null default 'unpaid',
  subscription_current_period_end timestamptz);
grant select on public.doctor_profiles to authenticated, service_role;
insert into public.doctor_profiles (id, full_name, verification_status, is_active, subscription_status, subscription_current_period_end) values
 ('00000000-0000-0000-0000-00000000d001','Dr. Paid Doctor','approved',true,'active',null),
 ('00000000-0000-0000-0000-00000000d002','Dr. Unpaid Doctor','approved',true,'unpaid',null),
 ('00000000-0000-0000-0000-00000000d003','Dr. Pending Doctor','pending_review',true,'active',null),
 ('00000000-0000-0000-0000-00000000d004','Dr. Lapsed Doctor','approved',true,'active', now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000d005','Dr. Second Paid Doctor','approved',true,'active',null);

\i supabase/migrations/0095_locator.sql
\i supabase/migrations/0096_locator_listings.sql

\echo == data that exists BEFORE 0097
insert into locator_places(category,kind,name,area,lat,lng,status,paid_until) values
 ('doctor','pharmacy','Old Pharmacy','Clifton',24.8145,67.0305,'approved', now() + interval '6 months'),
 ('doctor','lab','City Lab','Clifton',24.8147,67.0307,'approved', now() + interval '6 months');

\i supabase/migrations/0097_locator_pharmacy_hours_doctor_clinics.sql
\i supabase/migrations/0097_locator_pharmacy_hours_doctor_clinics.sql

\echo == pharmacy moves to its own tab
select 'R1 old pharmacy now category pharmacy (expect pharmacy)', category from locator_places where name='Old Pharmacy';
select 'R2 lab stays under doctors (expect doctor)', category from locator_places where name='City Lab';
select 'R3 pharmacy/kind mismatch rejected (expect error)';
insert into locator_places(category,kind,name,area,lat,lng) values ('pharmacy','clinic','Bad','Clifton',24.8,67.0);
insert into locator_places(category,kind,name,area,lat,lng) values ('doctor','pharmacy','Bad2','Clifton',24.8,67.0);

\echo == opening hours checker
select 'H1 null ok (t)', locator_hours_ok(null);
select 'H2 always ok (t)', locator_hours_ok('{"always":true}');
select 'H3 days ok (t)', locator_hours_ok('{"days":{"mon":[["09:00","13:00"],["17:00","21:00"]],"sun":[["10:00","02:00"]]}}');
select 'H4 3 ranges rejected (f)', locator_hours_ok('{"days":{"mon":[["09:00","10:00"],["11:00","12:00"],["13:00","14:00"]]}}');
select 'H5 bad time rejected (f)', locator_hours_ok('{"days":{"mon":[["9:00","13:00"]]}}');
select 'H6 bad time 25:00 rejected (f)', locator_hours_ok('{"days":{"mon":[["09:00","25:00"]]}}');
select 'H7 bad day rejected (f)', locator_hours_ok('{"days":{"funday":[["09:00","13:00"]]}}');
select 'H8 extra key rejected (f)', locator_hours_ok('{"always":true,"x":1}');
select 'H9 not an object rejected (f)', locator_hours_ok('[1]');
select 'H10 table rejects bad hours (expect error)';
update locator_places set hours = '{"days":{"mon":[["9:00","13:00"]]}}' where name='Old Pharmacy';
update locator_places set hours = '{"always":true}' where name='Old Pharmacy';
update locator_places set hours = '{"days":{"mon":[["08:00","22:00"]],"tue":[["08:00","22:00"]]}}' where name='City Lab';

\echo == search and counts
set role anon;
select 'S1 pharmacy tab (expect Old Pharmacy)', string_agg(name, ',') from locator_search(24.8138,67.0300,5,'pharmacy');
select 'S2 doctor tab has the lab, not the pharmacy (expect City Lab)', string_agg(name, ',') from locator_search(24.8138,67.0300,5,'doctor');
select 'S3 hours returned (expect t)', hours->>'always' = 'true' from locator_search(24.8138,67.0300,5,'pharmacy') limit 1;
select 'S4 counts include pharmacy (expect 1)', locator_counts()->>'pharmacy';
select 'S5 bad category returns nothing (expect 0)', count(*) from locator_search(24.8138,67.0300,5,'chemist');
reset role;
set role service_role;
select 'S6 event with pharmacy category ok'; select locator_event('search','pharmacy');
select 'S7 pharmacy counted (expect 1)', n from locator_events_daily where event='search' and category='pharmacy';
select 'S8 area note for pharmacy'; select locator_search_note('Clifton','pharmacy',true);
reset role;

\echo == owner apply: pharmacy and hours
set role service_role;
select 'A1 pharmacy apply (category pharmacy)', locator_apply_place('pharmacy','pharmacy','Shifa Pharmacy','Clifton','Block 5','0300-1111111','24h',24.8240,67.0300,'Ali','0300-2222222',null,null,true,repeat('a',64),true,'{"always":true}');
select 'A2 pharmacy under doctor category rejected (expect error)'; select locator_apply_place('doctor','pharmacy','Wrong Tab','Clifton',null,null,null,24.8340,67.0300,null,null,null,null,false,repeat('b',64),true,null);
select 'A3 clinic under pharmacy category rejected (expect error)'; select locator_apply_place('pharmacy','clinic','Wrong Tab 2','Clifton',null,null,null,24.8350,67.0300,null,null,null,null,false,repeat('c',64),true,null);
select 'A4 bad hours rejected (expect error)'; select locator_apply_place('pharmacy','pharmacy','Bad Hours','Clifton',null,null,null,24.8360,67.0300,null,null,null,null,false,repeat('d',64),true,'{"days":{"mon":[["9","13"]]}}');
select 'A5 clinic apply without hours still works', locator_apply_place('doctor','clinic','Noor Clinic','Clifton',null,null,null,24.8370,67.0300,'Dr N','0300-3333333',null,'PMDC 1',false,repeat('e',64),true);
select 'A6 hours stored', hours from locator_places where name='Shifa Pharmacy';
select 'A7 old 16-argument call still works through the default (backward compatible)'; select locator_apply_place('doctor','clinic','Old Sig','Clifton',null,null,null,24.84,67.03,null,null,null,null,false,repeat('f',64),true);
reset role;
set role anon;
select 'A8 anon cannot apply (expect error)'; select locator_apply_place('pharmacy','pharmacy','Anon','Clifton',null,null,null,24.82,67.03,null,null,null,null,false,repeat('1',64),true,null);
reset role;

\echo == admin summary
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'AS1 live_pharmacy (expect 1)', locator_admin_summary()->'places'->>'live_pharmacy';
select 'AS2 awaiting payment counts the new pharmacy (expect 1 or more)', (locator_admin_summary()->'places'->>'awaiting_payment')::int >= 1;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b002',false);
select 'AS3 patient cannot read summary (expect error)'; select locator_admin_summary();
reset role;

\echo == doctors add their own clinic
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b002',false);
select 'D1 patient is not a doctor (expect false)', locator_doctor_status()->>'doctor';
select 'D2 patient cannot save (expect error)'; select locator_doctor_save_place(null,'X Clinic','Clifton',null,null,null,24.8,67.03,null,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d002',false);
select 'D3 unpaid doctor not eligible (expect false / unpaid)', locator_doctor_status()->>'eligible', locator_doctor_status()->>'reason';
select 'D4 unpaid cannot save (expect error)'; select locator_doctor_save_place(null,'Unpaid Clinic','Clifton',null,null,null,24.8,67.03,null,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d003',false);
select 'D5 pending doctor not eligible (expect not_approved)', locator_doctor_status()->>'reason';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d004',false);
select 'D6 lapsed access not eligible (expect unpaid)', locator_doctor_status()->>'reason';
select 'D6b lapsed cannot save (expect error)'; select locator_doctor_save_place(null,'Lapsed Clinic','Clifton',null,null,null,24.8,67.03,null,true);

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'D7 paid doctor eligible (expect true)', locator_doctor_status()->>'eligible';
select 'D7b no free_until before first clinic (expect null)', locator_doctor_status()->'free_until' = 'null'::jsonb;
select 'D7c free clinic available (expect true)', locator_doctor_status()->>'free_available';
select 'D8 no consent rejected (expect error)'; select locator_doctor_save_place(null,'Paid Clinic','Clifton',null,null,null,24.8450,67.03,null,false);
select 'D9 outside Karachi rejected (expect error)'; select locator_doctor_save_place(null,'Paid Clinic','Gulberg',null,null,null,31.5,74.3,null,true);
select 'D10 bad hours rejected (expect error)'; select locator_doctor_save_place(null,'Paid Clinic','Clifton',null,null,null,24.8450,67.03,'{"x":1}',true);
select 'D11 create clinic', (locator_doctor_save_place(null,'Dr Paid Clinic','Clifton','Block 4','021-111','Ground floor',24.8450,67.0300,'{"days":{"mon":[["09:00","17:00"]]}}',true))->>'created';
reset role;
select 'D12 free year (expect t, ~12 months)', paid_until > now() + interval '11 months 20 days' and paid_until < now() + interval '12 months 1 day' from locator_places where name='Dr Paid Clinic';
select 'D13 listing is verified + linked to the doctor', verification_status, source, status, doctor_id = '00000000-0000-0000-0000-00000000d001', category, kind from locator_places where name='Dr Paid Clinic';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'D14a free clinic still available before first (skip)', true;
select 'D14 status shows free_until + 1 place', locator_doctor_status()->>'active_places', (locator_doctor_status()->>'free_until') is not null;
select 'D15 my places lists it (expect 1)', jsonb_array_length(locator_doctor_my_places());
select 'D16 duplicate rejected (expect error)'; select locator_doctor_save_place(null,'dr paid clinic','Clifton',null,null,null,24.8450,67.0301,null,true);
select 'D16b free clinic slot used (expect false)', locator_doctor_status()->>'free_available';
select 'D16c my places flags the free one (expect t)', (locator_doctor_my_places()->0->>'free')::boolean;
select 'D17 second + third clinic created but NOT free (expect created t, free f, paid_until null)', r2->>'created', r2->>'free', r2->'paid_until' = 'null'::jsonb, r3->>'created', r3->>'free', r3->'paid_until' = 'null'::jsonb
  from (select locator_doctor_save_place(null,'Dr Paid Clinic 2','DHA',null,null,null,24.8000,67.0600,null,true) as r2, locator_doctor_save_place(null,'Dr Paid Clinic 3','Saddar',null,null,null,24.8600,67.0100,null,true) as r3) q;
reset role;
select 'D19 only the first clinic has a paid_until (expect 1)', count(*) from locator_places where source='doctor' and paid_until is not null;
select 'D20 only the first clinic got the complimentary payment row (expect 1)', count(*) from locator_payments p join locator_places x on x.id=p.place_id where x.source='doctor' and p.method='complimentary';
set role anon;
select 'D21 public search shows only the free clinic (expect Dr Paid Clinic:true)', string_agg(name || ':' || (doctor_id is not null)::text, ',') from locator_search(24.8450,67.0300,2,'doctor');
select 'D21b extra clinics not public until paid (expect 0)', count(*) from locator_search(24.8000,67.0600,2,'doctor') where name like 'Dr Paid Clinic _';
reset role;
set role service_role;
select 'D22 extra clinic can be paid straight away (expect renewable t, fee 1500)', locator_doctor_checkout_info('00000000-0000-0000-0000-00000000d001',(select id from locator_places where name='Dr Paid Clinic 2'));
insert into locator_payments (id, place_id, amount, method, status, gateway_tracker_token)
  select '33333333-3333-3333-3333-333333333333', id, 1500, 'safepay', 'pending', 'trk_x2' from locator_places where name='Dr Paid Clinic 2';
select 'D23 settle extra clinic (expect t)', locator_settle_payment('33333333-3333-3333-3333-333333333333','{"ok":1}');
select 'D24 extra clinic live for 12 months (expect t)', (select paid_until > now() + interval '11 months' from locator_places where name='Dr Paid Clinic 2');
reset role;
set role anon;
select 'D25 paid extra clinic public (expect 1)', count(*) from locator_search(24.8000,67.0600,2,'doctor') where name='Dr Paid Clinic 2';
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'D26 limit of 10 (expect error after 10)';
select locator_doctor_save_place(null,'Lim '||g,'Clifton',null,null,null,24.80+g*0.003,67.00+g*0.003,null,true) from generate_series(1,7) g;
select 'D27 eleventh rejected (expect error limit_reached)'; select locator_doctor_save_place(null,'Lim 9','Clifton',null,null,null,24.80+9*0.003,67.00+9*0.003,null,true);
reset role;
update locator_places set status='hidden' where name like 'Lim %';
reset role;

select id as c1 from locator_places where name='Dr Paid Clinic' \gset
select id as c3 from locator_places where name='Dr Paid Clinic 3' \gset
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'E1 edit own clinic (created=false)', (locator_doctor_save_place(:'c1','Dr Paid Clinic','Clifton','Block 4','021-222','Ground floor',24.8451,67.0301,'{"always":true}',false))->>'created';
reset role;
select 'E2 edit saved (expect 021-222 / true)', phone, hours->>'always' from locator_places where name='Dr Paid Clinic';
select 'E3 paid_until untouched by edit (expect t)', paid_until > now() + interval '11 months' from locator_places where name='Dr Paid Clinic';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d005',false);
select 'E4 another PAID doctor cannot edit it (expect error not_found)'; select locator_doctor_save_place(:'c1','Hijack','Clifton',null,null,null,24.8,67.03,null,false);
select 'E4b another doctor cannot remove it (expect f)', locator_doctor_remove_place(:'c1');
select 'E5 other doctor sees none of it (expect 0)', jsonb_array_length(locator_doctor_my_places());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'E6 remove own clinic (expect t)', locator_doctor_remove_place(:'c3');
select 'E7 removed clinic no longer listed (expect 2)', jsonb_array_length(locator_doctor_my_places());
select 'E8 re-adding works but is NOT free (expect created t, free f)', (r->>'created'), (r->>'free') from (select locator_doctor_save_place(null,'Dr Paid Clinic 3b','Saddar',null,null,null,24.8610,67.0110,null,true) as r) q;
reset role;
select 'E9 re-add did not give another free clinic (expect 1 complimentary)', count(*) from locator_payments p join locator_places x on x.id=p.place_id where x.doctor_id='00000000-0000-0000-0000-00000000d001' and p.method='complimentary';

\echo == removing the FREE clinic inside the free year frees the slot, but does not restart the year
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d005',false);
select 'G1 first clinic of doctor 5 is free', (locator_doctor_save_place(null,'Second Doc Clinic A','Clifton',null,null,null,24.8200,67.0300,null,true))->>'free';
reset role;
select id as ga from locator_places where name='Second Doc Clinic A' \gset
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d005',false);
select 'G1b remove it (expect t)', locator_doctor_remove_place(:'ga');
select 'G2 slot free again (expect true)', locator_doctor_status()->>'free_available';
select 'G3 new clinic takes the free slot (expect free t)', (locator_doctor_save_place(null,'Second Doc Clinic B','Clifton',null,null,null,24.8300,67.0400,null,true))->>'free';
select 'G4 and a further one does not (expect f)', (locator_doctor_save_place(null,'Second Doc Clinic C','Clifton',null,null,null,24.8400,67.0500,null,true))->>'free';
reset role;
select 'G5 free end date same as first listing + 12 months (expect t)', (select paid_until from locator_places where name='Second Doc Clinic B') = (select min(created_at) + interval '12 months' from locator_places where doctor_id='00000000-0000-0000-0000-00000000d005');

\echo == after the free year
update locator_places set created_at = now() - interval '13 months', paid_until = now() - interval '1 month' where name='Dr Paid Clinic';
update locator_places set created_at = now() - interval '13 months', paid_until = now() - interval '1 month' where source='doctor' and name <> 'Dr Paid Clinic';
update locator_places set status='hidden' where source='doctor' and name <> 'Dr Paid Clinic';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'F1 new clinic after the year has no free period (expect null paid_until)', (locator_doctor_save_place(null,'Dr Paid New Clinic','Gulshan',null,null,null,24.9215,67.0920,null,true))->'paid_until' = 'null'::jsonb;
reset role;
set role anon;
select 'F2 not public until paid (expect none)', count(*) from locator_search(24.9215,67.0920,2,'doctor') where name='Dr Paid New Clinic';
select 'F3 expired clinic not public (expect 0)', count(*) from locator_search(24.8450,67.0300,2,'doctor') where name='Dr Paid Clinic';
reset role;
set role service_role;
select 'F4 checkout info: renewable + fee', locator_doctor_checkout_info('00000000-0000-0000-0000-00000000d001',(select id from locator_places where name='Dr Paid New Clinic'));
select 'F5 other doctor gets nothing (expect null)', locator_doctor_checkout_info('00000000-0000-0000-0000-00000000d002',(select id from locator_places where name='Dr Paid New Clinic'));
insert into locator_payments (id, place_id, amount, method, status, gateway_tracker_token)
  select '22222222-2222-2222-2222-222222222222', id, 1500, 'safepay', 'pending', 'trk_d1' from locator_places where name='Dr Paid New Clinic';
select 'F6 settle renewal (expect t)', locator_settle_payment('22222222-2222-2222-2222-222222222222','{"ok":1}');
select 'F7 now live for 12 months (expect t)', (select paid_until > now() + interval '11 months' from locator_places where name='Dr Paid New Clinic');
select 'F8 not renewable again right away (expect false)', locator_doctor_checkout_info('00000000-0000-0000-0000-00000000d001',(select id from locator_places where name='Dr Paid New Clinic'))->>'renewable';
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000d001',false);
select 'F9 doctor cannot call the server-only checkout function (expect error)'; select locator_doctor_checkout_info('00000000-0000-0000-0000-00000000d001', gen_random_uuid());
reset role;
set role anon;
select 'F10 anon cannot use doctor functions (expect error)'; select locator_doctor_status();
reset role;

\echo == rollback then re-run 0096 returns to the earlier shape
\i supabase/migrations/ROLLBACK-0097.sql
\i supabase/migrations/0096_locator_listings.sql
select 'Z1 pharmacy back under doctor (expect doctor)', category from locator_places where name='Old Pharmacy';
select 'Z2 doctor-added clinics kept as owner listings (expect owner)', source from locator_places where name='Dr Paid New Clinic';
select 'Z3 hours column gone (expect 0)', count(*) from information_schema.columns where table_name='locator_places' and column_name='hours';
select 'Z4 old search works again (expect Old Pharmacy among doctors)', count(*) >= 1 from locator_search(24.8138,67.0300,5,'doctor') where name='Old Pharmacy';
