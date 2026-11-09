-- Test for migration 0096 (paid + verified locator listings), on top of 0095.
-- Run: psql -f _t/pg_locator_setup.sql, then this file (from the repo root).
\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000a001','admin@x.com'),('00000000-0000-0000-0000-00000000b002','pat@x.com') on conflict do nothing;
insert into public.admin_profiles(id, full_name) values ('00000000-0000-0000-0000-00000000a001','Admin') on conflict do nothing;
\i supabase/migrations/0095_locator.sql

\echo == v1 data that exists BEFORE 0096 (grandfather check)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
insert into locator_places(category,kind,name,area,lat,lng,status) values
 ('doctor','clinic','Old Clinic','Clifton',24.8150,67.0310,'approved'),
 ('autism','barber','Calm Cuts','Clifton',24.8160,67.0320,'approved');
reset role;

\i supabase/migrations/0096_locator_listings.sql
\i supabase/migrations/0096_locator_listings.sql

select 'G1 old approved doctor got courtesy period (expect t)', paid_until > now() + interval '11 months' from locator_places where name='Old Clinic';
select 'G2 autism not given paid_until (expect t)', paid_until is null from locator_places where name='Calm Cuts';
select 'G3 fees seeded (expect 11)', count(*) from locator_fees;

\echo == service_role: apply flows
set role service_role;
-- pharmacy: no verification, goes live after payment
select 'A1 pharmacy apply', locator_apply_place('doctor','pharmacy','Shifa Pharmacy','Clifton','Block 5','0300-1111111','24h',24.8140,67.0300,'Ali','0300-2222222',null,null,true,repeat('a',64),true);
-- clinic: needs verification
select 'A2 clinic apply', locator_apply_place('doctor','clinic','Noor Clinic','Clifton',null,null,null,24.8300,67.0300,'Dr N','0300-3333333',null,'PMDC 12345',false,repeat('b',64),true);
-- therapy
select 'A3 therapy apply', locator_apply_place('therapy','autism_therapy','Hope Therapy Centre','Gulshan',null,null,null,24.9215,67.0920,'Sara','0300-4444444',null,'SHCC pending',true,repeat('c',64),true);
select 'A4 no consent rejected'; select locator_apply_place('doctor','pharmacy','No Consent','Clifton',null,null,null,24.8140,67.0300,null,null,null,null,false,repeat('d',64),false);
select 'A5 wrong category/kind rejected'; select locator_apply_place('therapy','pharmacy','Mismatch','Clifton',null,null,null,24.8100,67.0300,null,null,null,null,false,repeat('e',64),true);
select 'A6 outside Karachi rejected'; select locator_apply_place('doctor','pharmacy','Lahore Pharmacy','Gulberg',null,null,null,31.5,74.3,null,null,null,null,false,repeat('f',64),true);
select 'A7 duplicate rejected'; select locator_apply_place('doctor','pharmacy','shifa pharmacy','Clifton',null,null,null,24.8140,67.0301,null,null,null,null,false,repeat('9',64),true);
select 'A8 bad token rejected'; select locator_apply_place('doctor','pharmacy','Token Pharm','Clifton',null,null,null,24.8200,67.0300,null,null,null,null,false,'short',true);
select 'A9 status by type', name, status, verification_status from locator_places where source='owner' order by name;
reset role;

\echo == nothing unpaid or unverified is public
set role anon;
select 'V1 doctors visible (only Old Clinic, courtesy)', string_agg(name, ',') from locator_search(24.8138,67.0300,10,'doctor');
select 'V2 therapy visible (none)', count(*) from locator_search(24.9215,67.0920,5,'therapy');
select 'V3 autism free visible', string_agg(name, ',') from locator_search(24.8138,67.0300,5,'autism');
select 'V4 counts', locator_counts();
select 'V5 fee list public', jsonb_array_length(locator_fee_list());
select 'V6 anon cannot read payments'; select count(*) from locator_payments;
select 'V7 anon cannot apply'; select locator_apply_place('doctor','pharmacy','Anon Pharm','Clifton',null,null,null,24.82,67.03,null,null,null,null,false,repeat('1',64),true);
select 'V8 anon cannot settle'; select locator_settle_payment(gen_random_uuid(), '{}');
select 'V9 anon cannot read phone codes'; select count(*) from locator_phone_codes;
reset role;

\echo == paying (safepay path): pharmacy goes live
set role service_role;
insert into locator_payments (id, place_id, amount, method, status, gateway_tracker_token)
  select '11111111-1111-1111-1111-111111111111', id, 1000, 'safepay', 'pending', 'trk_1' from locator_places where name='Shifa Pharmacy';
select 'P1 settle (expect t)', locator_settle_payment('11111111-1111-1111-1111-111111111111', '{"ok":1}');
select 'P2 settle again idempotent (expect f)', locator_settle_payment('11111111-1111-1111-1111-111111111111', '{"ok":1}');
select 'P3 receipt + paid_until', receipt_no is not null, (select paid_until > now() + interval '11 months' from locator_places where name='Shifa Pharmacy') from locator_payments where id='11111111-1111-1111-1111-111111111111';
reset role;
set role anon;
select 'P4 pharmacy now visible, unverified shows listed', string_agg(name || ':' || verified::text, ',') from locator_search(24.8138,67.0300,10,'doctor');
reset role;

\echo == admin verifies a clinic, records cash payment
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'AD1 verify clinic', locator_admin_verify((select id from locator_places where name='Noor Clinic'),'verified','licence photo ok',null);
select 'AD2 clinic approved+verified', status, verification_status from locator_places where name='Noor Clinic';
select 'AD3 not visible until paid', count(*) from locator_search(24.8138,67.0300,10,'doctor') where name='Noor Clinic';
select 'AD4 record cash', (locator_admin_record_payment((select id from locator_places where name='Noor Clinic'),1500,'cash','received at office','',12)->>'receipt_no')::int > 1000;
select 'AD5 receipts sequential', string_agg(receipt_no::text, ',' order by receipt_no) from locator_payments;
select 'AD6 complimentary zero ok', locator_admin_record_payment((select id from locator_places where name='Hope Therapy Centre'),0,'complimentary','VWCO partner','',6)->>'receipt_no';
select 'AD7 zero cash rejected'; select locator_admin_record_payment((select id from locator_places where name='Noor Clinic'),0,'cash',null,null,12);
select 'AD8 reject sets hidden'; select locator_admin_verify((select id from locator_places where name='Hope Therapy Centre'),'rejected','no licence','Please send licence');
select 'AD8b', status, verification_status, rejection_reason from locator_places where name='Hope Therapy Centre';
select 'AD9 revenue excludes complimentary', (locator_admin_summary()->>'revenue_total')::int;
select 'AD10 link made', char_length(locator_admin_make_link((select id from locator_places where name='Noor Clinic'))) = 64;
select 'AD11 summary shape', locator_admin_summary()->'places';
select 'AD12 fee edit', 1; update locator_fees set fee_pkr = 2000 where kind='clinic'; select fee_pkr from locator_fees where kind='clinic';
reset role;

\echo == non-admin patient cannot use admin functions
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b002',false);
select 'N1 cannot verify'; select locator_admin_verify(gen_random_uuid(),'verified',null,null);
select 'N2 cannot record payment'; select locator_admin_record_payment(gen_random_uuid(),100,'cash',null,null,12);
select 'N3 cannot summary'; select locator_admin_summary();
select 'N4 cannot make link'; select locator_admin_make_link(gen_random_uuid());
select 'N5 cannot edit fees'; update locator_fees set fee_pkr = 1; select 'N5b unchanged', fee_pkr from locator_fees where kind='pharmacy';
select 'N6 sees no payments', count(*) from locator_payments;
reset role;

\echo == visible set after admin work
set role anon;
select 'X1 doctors', string_agg(name || ':' || verified::text, ',' order by name) from locator_search(24.8138,67.0300,10,'doctor');
select 'X2 rounded coordinates (3 decimals)', map_lat, map_lng from locator_search(24.8138,67.0300,5,'doctor') where name='Old Clinic';
select 'X3 no featured by default', count(*) from locator_search(24.8138,67.0300,10,'doctor') where featured;
reset role;

\echo == featured cap of 2 and ordering
update locator_places set featured_until = now() + interval '5 days', paid_until = now() + interval '1 year', status='approved'
 where name in ('Shifa Pharmacy','Noor Clinic','Old Clinic');
set role anon;
select 'F1 only 2 featured', count(*) filter (where featured) from locator_search(24.8138,67.0300,10,'doctor');
select 'F2 featured first', (array_agg(featured order by ord))[1] from (select featured, row_number() over () ord from locator_search(24.8138,67.0300,10,'doctor')) z;
reset role;

\echo == owner manage view + token
set role service_role;
select 'M1 view by hash', locator_manage_view(repeat('a',64))->>'name', locator_manage_view(repeat('a',64))->>'live';
select 'M2 wrong hash null', locator_manage_view(repeat('z',64)) is null;
select 'M3 owner view has no stats', not (locator_manage_view(repeat('a',64)) ? 'stats30');
select 'M3 checkout info', locator_checkout_info(repeat('c',64))->>'fee_pkr';
select 'M4 attach proof', locator_attach_proof((select id from locator_places where name='Hope Therapy Centre'), repeat('c',64), 'p/1.jpg');
select 'M5 wrong hash cannot attach', locator_attach_proof((select id from locator_places where name='Hope Therapy Centre'), repeat('x',64), 'p/2.jpg');
select 'M6 proof max 6';
select locator_attach_proof((select id from locator_places where name='Hope Therapy Centre'), repeat('c',64), 'p/'||g||'.jpg') from generate_series(2,9) g;
select 'M6b proofs stored', array_length(proof_paths,1) from locator_places where name='Hope Therapy Centre';
reset role;

\echo == counters, reports, directions target
set role service_role;
select 'C1 shown', locator_places_shown(array(select id from locator_places where status='approved'));
select 'C2 directions target (live place)', locator_directions_target((select id from locator_places where name='Old Clinic'))->>'name';
select 'C2b unpaid not served', locator_directions_target((select id from locator_places where name='Hope Therapy Centre')) is null;
select 'C3 call', locator_place_event((select id from locator_places where name='Old Clinic'),'call');
select 'C3b bad event ignored', locator_place_event((select id from locator_places where name='Old Clinic'),'hack');
select 'C4 area note', locator_search_note('Clifton','doctor',true), locator_search_note('Clifton','doctor',false), locator_search_note(' ','doctor',true), locator_search_note('X','bogus',true);
select 'C5 report ok', locator_report((select id from locator_places where name='Old Clinic'),'closed','permanently shut');
select 'C5b bad reason', locator_report((select id from locator_places where name='Old Clinic'),'zzz',null);
select 'C6 usage events new', locator_event('apply','therapy'), locator_event('paid','doctor'), locator_event('bogus','doctor');
select 'C6b', event, category, n from locator_events_daily where event in ('apply','paid') order by 1,2;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'C7 place stats', locator_admin_place_stats((select id from locator_places where name='Old Clinic'));
select 'C8 summary events', locator_admin_summary()->'top_places_30d'->0->>'name', locator_admin_summary()->'top_areas_30d'->0, locator_admin_summary()->>'open_reports';
reset role;

\echo == phone code helper
set role service_role;
select 'K1 issue', locator_code_issue('03001234567','h1');
select 'K2 too soon', locator_code_issue('03001234567','h2');
select 'K3 wrong code', locator_code_check('03001234567','nope');
select 'K4 right code', locator_code_check('03001234567','h1');
select 'K5 code single use', locator_code_check('03001234567','h1');
select 'K6 5 wrong tries lock'; select locator_code_issue('03009999999','hh');
select locator_code_check('03009999999','x') from generate_series(1,5);
select 'K6b locked even with right code', locator_code_check('03009999999','hh');
reset role;

\echo == purge drafts (admin)
set role service_role;
select 'D0 stale unpaid draft', locator_apply_place('doctor','pharmacy','Stale Draft Pharmacy','Clifton',null,null,null,24.8500,67.0400,null,null,null,null,false,repeat('7',64),true)->>'fee_pkr';
reset role;
update locator_places set created_at = now() - interval '40 days' where name in ('Stale Draft Pharmacy');
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'D1 purged unpaid old drafts', locator_admin_purge_drafts();
select 'D1b paid old place kept', count(*) from locator_places where name='Hope Therapy Centre';
select 'D2 remaining owner places', string_agg(name, ',' order by name) from locator_places where source='owner';
reset role;

\echo == rollback then re-run 0095 returns to v1 shape
\i supabase/migrations/ROLLBACK-0096.sql
\i supabase/migrations/0095_locator.sql
select 'R1 v1 search works', count(*) from locator_search(24.8138,67.0300,10,'doctor');
select 'R2 columns gone', count(*) from information_schema.columns where table_name='locator_places' and column_name='paid_until';
select 'R3 v2 tables gone', count(*) from information_schema.tables where table_name in ('locator_fees','locator_payments','locator_reports');
\i supabase/migrations/0096_locator_listings.sql
select 'R4 re-apply 0096 after rollback ok', count(*) from locator_fees;
