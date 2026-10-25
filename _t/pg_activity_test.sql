\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
create table if not exists auth.sessions (id uuid default gen_random_uuid(), user_id uuid, updated_at timestamptz default now());
grant select on auth.sessions to service_role;
\i supabase/migrations/0086_admin_doctor_activity.sql
\i supabase/migrations/0086_admin_doctor_activity.sql
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000a001','admin@x.com') on conflict do nothing;
insert into public.admin_profiles(id, full_name) values ('00000000-0000-0000-0000-00000000a001','Admin') on conflict do nothing;
insert into auth.users(id,email,last_sign_in_at) values
 ('00000000-0000-0000-0000-0000000000b1','busy@x.com', now()-interval '1 day'),
 ('00000000-0000-0000-0000-0000000000b2','nologin@x.com', now()-interval '10 days'),
 ('00000000-0000-0000-0000-0000000000b3','phone@x.com', now()-interval '30 days'),
 ('00000000-0000-0000-0000-0000000000b4','old-no-consult@x.com', now()-interval '2 days'),
 ('00000000-0000-0000-0000-0000000000b5','new@x.com', null),
 ('00000000-0000-0000-0000-0000000000b6','unapproved@x.com', null),
 ('00000000-0000-0000-0000-0000000000b7','deactivated@x.com', null),
 ('00000000-0000-0000-0000-0000000000b8','pending-only@x.com', now());
insert into public.doctor_profiles(id,full_name,email,verification_status,is_active,created_at,subscription_started_at) values
 ('00000000-0000-0000-0000-0000000000b1','Busy','busy@x.com','approved',true, now()-interval '1 year', now()-interval '1 year'),
 ('00000000-0000-0000-0000-0000000000b2','NoLogin10d','nologin@x.com','approved',true, now()-interval '1 year', now()-interval '1 year'),
 ('00000000-0000-0000-0000-0000000000b3','PhoneSession','phone@x.com','approved',true, now()-interval '1 year', now()-interval '1 year'),
 ('00000000-0000-0000-0000-0000000000b4','OldNoConsult','old-no-consult@x.com','approved',true, now()-interval '8 months', now()-interval '8 months'),
 ('00000000-0000-0000-0000-0000000000b5','BrandNew','new@x.com','approved',true, now()-interval '2 days', null),
 ('00000000-0000-0000-0000-0000000000b6','Unapproved','unapproved@x.com','pending_review',true, now()-interval '1 year', null),
 ('00000000-0000-0000-0000-0000000000b7','Deactivated','deactivated@x.com','approved',false, now()-interval '1 year', null),
 ('00000000-0000-0000-0000-0000000000b8','PendingPayOnly','pending-only@x.com','approved',true, now()-interval '1 year', now()-interval '1 year');
-- phone doctor: last password sign-in 30 days ago, but a session refreshed yesterday
insert into auth.sessions(user_id, updated_at) values ('00000000-0000-0000-0000-0000000000b3', now()-interval '1 day');
set session_replication_role = replica;
insert into public.consultations(patient_id, doctor_id, complaint, status, created_at) values
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','x','completed', now()-interval '5 days'),
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b2','x','submitted', now()-interval '20 days'),
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b3','x','completed', now()-interval '2 months'),
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b4','x','completed', now()-interval '4 months'),
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b8','x','pending_payment', now()-interval '1 day'),
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b8','x','cancelled', now()-interval '1 day');
set session_replication_role = origin;

\echo == admin sees flags
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'A', d.full_name, a.no_consultation_3m as no_consult, a.not_logged_in_4d as no_login from admin_doctor_activity() a join doctor_profiles d on d.id=a.doctor_id order by d.full_name;
reset role;
\echo == non-admin and anon blocked
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select * from admin_doctor_activity();
reset role;
set role anon; select * from admin_doctor_activity();
reset role;
