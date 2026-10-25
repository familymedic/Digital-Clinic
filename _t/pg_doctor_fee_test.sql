\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
-- seed doctors in every state, BEFORE 0085
insert into auth.users(id,email) select ('00000000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid, 'd'||i||'@x.com' from generate_series(1,8) i on conflict do nothing;
insert into public.doctor_profiles(id,full_name,email,verification_status,is_active,fee_status,consultation_fee,subscription_status,subscription_current_period_end,use_safepay_checkout) values
 ('00000000-0000-0000-0000-000000000001','Active10d','d1@x.com','approved',true,'approved',1000,'active', now()+interval '10 days', false),
 ('00000000-0000-0000-0000-000000000002','ActiveNoEnd','d2@x.com','approved',true,'approved',1000,'active', null, true),
 ('00000000-0000-0000-0000-000000000003','Lapsed','d3@x.com','approved',true,'approved',1000,'active', now()-interval '2 days', false),
 ('00000000-0000-0000-0000-000000000004','Unpaid','d4@x.com','approved',true,'approved',1000,'unpaid', null, true),
 ('00000000-0000-0000-0000-000000000005','Canceled','d5@x.com','approved',true,'approved',1000,'canceled', now()+interval '5 days', false),
 ('00000000-0000-0000-0000-000000000006','Pending','d6@x.com','pending_review',true,'not_set',null,'unpaid', null, true),
 ('00000000-0000-0000-0000-000000000007','PastDue','d7@x.com','approved',true,'approved',1000,'past_due', null, false),
 ('00000000-0000-0000-0000-000000000008','Active1d','d8@x.com','approved',true,'approved',1000,'active', now()+interval '1 day', false);
insert into public.doctor_access_payments(id,doctor_id,amount,gateway_environment,status) values
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004',2500,'sandbox','pending'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003',2500,'sandbox','pending');
select 'directory before', count(*) from public_doctor_directory;

\echo == apply 0085 twice (idempotent)
\i supabase/migrations/0085_doctor_one_time_fee.sql
\i supabase/migrations/0085_doctor_one_time_fee.sql
select 'T1 active-with-end now NULL end (2 rows: d1,d8 + d2)', count(*) from doctor_profiles where subscription_status='active' and subscription_current_period_end is null;
select 'T2 lapsed untouched (end still in past)', subscription_current_period_end < now() from doctor_profiles where full_name='Lapsed';
select 'T3 unpaid untouched', subscription_status, subscription_current_period_end is null from doctor_profiles where full_name='Unpaid';
select 'T4 canceled keeps canceled + its end', subscription_status, subscription_current_period_end is not null from doctor_profiles where full_name='Canceled';
select 'T5 all on safepay checkout', bool_and(use_safepay_checkout) from doctor_profiles;
select 'T6 backup rows', count(*) from doctor_fee_0085_backup;
select 'T7 backup kept ORIGINAL end for d1 (second run did not overwrite)', old_period_end is not null from doctor_fee_0085_backup where doctor_id='00000000-0000-0000-0000-000000000001';
select 'T8 directory after: 3 active doctors visible', count(*) from public_doctor_directory;
select 'T9 lapsed + unpaid hidden from directory', count(*) from public_doctor_directory where full_name in ('Lapsed','Unpaid','Canceled','PastDue','Pending');

\echo == settle
set role service_role;
select 'S1 unpaid settles', settle_doctor_access_payment('10000000-0000-0000-0000-000000000004', '{"x":1}');
select 'S2 second call is a no-op', settle_doctor_access_payment('10000000-0000-0000-0000-000000000004', '{"x":2}');
select 'S3 lapsed settles', settle_doctor_access_payment('10000000-0000-0000-0000-000000000003', null);
select 'S4 unknown id', settle_doctor_access_payment('99999999-0000-0000-0000-000000000000', null);
reset role;
select 'S5 Unpaid now active forever', subscription_status, subscription_current_period_end is null, subscription_started_at is not null from doctor_profiles where full_name='Unpaid';
select 'S6 Lapsed now active forever', subscription_status, subscription_current_period_end is null from doctor_profiles where full_name='Lapsed';
select 'S7 payment rows succeeded, no end', status, period_end is null, paid_at is not null from doctor_access_payments order by doctor_id;
select 'S8 one event per payment', count(*) from doctor_subscription_events where event_type='access_payment.succeeded';
select 'S9 directory now shows both', count(*) from public_doctor_directory where full_name in ('Lapsed','Unpaid');

\echo == browser roles cannot settle
set role anon; select settle_doctor_access_payment('10000000-0000-0000-0000-000000000004', null);
reset role;
set role authenticated; select settle_doctor_access_payment('10000000-0000-0000-0000-000000000004', null);
reset role;

\echo == rollback
\i supabase/ROLLBACK-0085.sql
select 'R1 d1 end restored', subscription_current_period_end is not null from doctor_profiles where full_name='Active10d';
select 'R2 d2 still no end', subscription_current_period_end is null from doctor_profiles where full_name='ActiveNoEnd';
select 'R3 Unpaid back to unpaid', subscription_status from doctor_profiles where full_name='Unpaid';
select 'R4 checkout flag restored for d1 (false)', use_safepay_checkout from doctor_profiles where full_name='Active10d';
select 'R5 backup table gone', to_regclass('public.doctor_fee_0085_backup') is null;
set role service_role;
select 'R6 old 30-day settle back', (settle_doctor_access_payment('10000000-0000-0000-0000-000000000004'))::text;
reset role;
