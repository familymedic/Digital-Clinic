\set ON_ERROR_STOP off
\set VERBOSITY terse
\pset tuples_only on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000a001','admin@x.com') on conflict do nothing;
insert into public.admin_profiles(id, full_name) values ('00000000-0000-0000-0000-00000000a001','Admin') on conflict do nothing;
\i supabase/migrations/0087_habit_league_min_and_views.sql
\i supabase/migrations/0087_habit_league_min_and_views.sql
grant all on all tables in schema public to anon, authenticated, service_role;
select 'setting default', league_min_entries from habit_settings;
select set_config('t.kar', (select id::text from habit_cities where name='Karachi' limit 1), false);
select set_config('t.lhr', (select id::text from habit_cities where name='Lahore' limit 1), false);
select set_config('t.sgr', (select id::text from habit_cities where name='Sanghar' limit 1), false);
select set_config('t.mul', (select id::text from habit_cities where name='Multan' limit 1), false);
select 'ids', current_setting('t.kar'), current_setting('t.lhr'), current_setting('t.sgr'), current_setting('t.mul');
set role service_role;
-- Sanghar: ONE perfect play (score ~ high). Karachi: 50 plays, mid. Lahore: exactly 10. Multan: 9.
select count(*) filter (where habit_submit(current_setting('t.sgr')::int,'male',array[0,0,0,0,0,0,0,0],false) is not null) from generate_series(1,1) x;
select count(*) filter (where habit_submit(current_setting('t.kar')::int,'male',array[2,2,2,2,2,2,2,2],false) is not null) from generate_series(1,50) x;
select count(*) filter (where habit_submit(current_setting('t.lhr')::int,'female',array[1,1,1,1,1,1,1,1],false) is not null) from generate_series(1,10) x;
select count(*) filter (where habit_submit(current_setting('t.mul')::int,'female',array[1,1,1,1,1,1,1,1],false) is not null) from generate_series(1,9) x;
select count(*) filter (where habit_event('visit') is not null) from generate_series(1,5) x;
reset role;
-- yesterday and 20 days ago visits/rounds, to test the windows
insert into habit_events_daily(day,event,n) values
  (habit_today()-1,'visit',7),(habit_today()-1,'complete',3),
  (habit_today()-20,'visit',11),(habit_today()-40,'visit',99)
on conflict (day,event) do update set n = habit_events_daily.n + excluded.n;
-- last week's Karachi data (prev window) with 12 plays so delta shows
insert into habit_daily(day,city_id,gender,rounds,score_sum) values (habit_today()-9, current_setting('t.kar')::int,'male',12,12*40)
 on conflict (day,city_id,gender) do update set rounds = habit_daily.rounds + 12, score_sum = habit_daily.score_sum + 12*40;
insert into habit_daily(day,city_id,gender,rounds,score_sum) values (habit_today()-9, current_setting('t.lhr')::int,'female',3,3*40)
 on conflict (day,city_id,gender) do update set rounds = habit_daily.rounds + 3, score_sum = habit_daily.score_sum + 3*40;

\echo == public league (anon)
set role anon;
select 'L1 cities shown', jsonb_array_length(habit_public_league()->'cities');
select 'L2 names', string_agg(c->>'name', ',' order by c->>'name') from jsonb_array_elements(habit_public_league()->'cities') c;
select 'L3 Sanghar hidden', count(*) from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Sanghar';
select 'L4 Multan(9) hidden', count(*) from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Multan';
select 'L5 Lahore(10) shown', count(*) from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Lahore';
select 'L6 Karachi has delta (prev>=10)', (c->>'delta') is not null from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Karachi';
select 'L7 Lahore no delta (prev=3<10)', (c->>'delta') is null from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Lahore';
select 'L8 payload league_min', habit_public_league()->>'league_min';
select 'L9 no counts leaked when off', count(*) from jsonb_array_elements(habit_public_league()->'cities') c where c ? 'entries';
reset role;

\echo == admin settings
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'A1 get has league_min_entries', habit_admin_get()->>'league_min_entries';
select 'A2 old-style 5-arg save still works', habit_admin_save(true,true,false,100,false);
select 'A2b league_min unchanged', habit_admin_get()->>'league_min_entries';
select 'A3 save with league min 20', habit_admin_save(true,true,false,100,false,20);
select 'A3b now 20', habit_admin_get()->>'league_min_entries';
select 'A3c league now has', jsonb_array_length(habit_public_league()->'cities');
select 'A4 bad league min 0', habit_admin_save(true,true,false,100,false,0);
select 'A5 bad league min null keeps', habit_admin_save(true,true,false,100,false,null);
select 'A5b', habit_admin_get()->>'league_min_entries';
select habit_admin_save(true,true,false,100,false,10);
\echo == views
select 'V visit', habit_admin_views()->'visit';
select 'V complete', habit_admin_views()->'complete';
select 'V start', habit_admin_views()->'start';
reset role;
\echo == non admin blocked
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false);
select habit_admin_views();
select habit_admin_save(true,true,false,100,false,1);
reset role;
set role anon; select habit_admin_views(); reset role;

\echo == rollback
\i supabase/ROLLBACK-0087.sql
set role anon;
select 'R1 old league shows Sanghar again', count(*) from jsonb_array_elements(habit_public_league()->'cities') c where c->>'name'='Sanghar';
reset role;
select 'R2 column gone', count(*) from information_schema.columns where table_name='habit_settings' and column_name='league_min_entries';
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
select 'R3 5-arg save works', habit_admin_save(true,true,false,100,false);
select 'R4 views gone', habit_admin_views();
reset role;
