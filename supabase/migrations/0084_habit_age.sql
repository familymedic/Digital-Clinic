-- 0084: Habit Age game + city league (2026-10-23).
--
-- A free, anonymous quiz on the website. Players answer 8 everyday-habit
-- questions and get a fun "Habit Age". Players can pick a city, and the
-- results are added up into a city league with a weekly winner.
--
-- PRIVACY BY DESIGN: this stores ONLY anonymous totals. No names, phone
-- numbers, emails, IP addresses, device ids or individual answers are
-- stored. One round adds +1 to a counter for (day, city, gender) and adds
-- its points to running sums. Nobody can be picked out of these tables.
--
-- Safe to run more than once. Nothing existing is changed. See
-- ROLLBACK-0084.sql to remove it.
--
-- How the data is protected:
-- - habit_settings / habit_daily / habit_events_daily / habit_winners have
--   row level security on and NO policies: nobody can read or write them
--   directly. They are reached only through the functions below.
-- - habit_submit() and habit_event() can only be called by the server
--   (service_role), never by a browser, so the website's own API route can
--   check and rate-limit every entry first.
-- - The public league / winners functions return only city names and
--   averages (and entry counts only when the admin has switched counts on).
-- - Admin functions check admin_profiles themselves.
-- - habit_cities (the list of places) is readable by everyone (active
--   places only) and editable only by admins.

-- ---------------------------------------------------------------- settings
create table if not exists public.habit_settings (
  id int primary key default 1 check (id = 1),
  game_live boolean not null default true,
  league_live boolean not null default true,
  show_counts boolean not null default false,
  min_entries int not null default 100 check (min_entries between 1 and 1000000),
  auto_publish boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.habit_settings (id) values (1) on conflict (id) do nothing;
alter table public.habit_settings enable row level security;

-- ------------------------------------------------------------------ cities
create table if not exists public.habit_cities (
  id int generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 60),
  province text not null check (province in
    ('Punjab','Sindh','Khyber Pakhtunkhwa','Balochistan','Islamabad','Gilgit-Baltistan','Azad Kashmir')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists habit_cities_name_province_uq
  on public.habit_cities (lower(name), province);
alter table public.habit_cities enable row level security;

drop policy if exists "Anyone can read active habit cities" on public.habit_cities;
create policy "Anyone can read active habit cities"
  on public.habit_cities for select
  using (is_active or exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can add habit cities" on public.habit_cities;
create policy "Admins can add habit cities"
  on public.habit_cities for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can edit habit cities" on public.habit_cities;
create policy "Admins can edit habit cities"
  on public.habit_cities for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Places are never hard-deleted (their old totals stay meaningful);
-- admins switch a place off with is_active = false.

insert into public.habit_cities (name, province) values
 -- Punjab
 ('Lahore','Punjab'),('Faisalabad','Punjab'),('Rawalpindi','Punjab'),('Gujranwala','Punjab'),('Multan','Punjab'),
 ('Sialkot','Punjab'),('Bahawalpur','Punjab'),('Sargodha','Punjab'),('Sheikhupura','Punjab'),('Jhang','Punjab'),
 ('Gujrat','Punjab'),('Kasur','Punjab'),('Rahim Yar Khan','Punjab'),('Sahiwal','Punjab'),('Okara','Punjab'),
 ('Wah Cantonment','Punjab'),('Dera Ghazi Khan','Punjab'),('Mandi Bahauddin','Punjab'),('Chiniot','Punjab'),
 ('Hafizabad','Punjab'),('Kamoke','Punjab'),('Burewala','Punjab'),('Jhelum','Punjab'),('Sadiqabad','Punjab'),
 ('Khanewal','Punjab'),('Hasilpur','Punjab'),('Muzaffargarh','Punjab'),('Khanpur','Punjab'),('Gojra','Punjab'),
 ('Mianwali','Punjab'),('Bhakkar','Punjab'),('Layyah','Punjab'),('Attock','Punjab'),('Chakwal','Punjab'),
 ('Narowal','Punjab'),('Pakpattan','Punjab'),('Toba Tek Singh','Punjab'),('Vehari','Punjab'),('Lodhran','Punjab'),
 ('Bahawalnagar','Punjab'),('Daska','Punjab'),('Muridke','Punjab'),('Wazirabad','Punjab'),('Samundri','Punjab'),
 ('Jaranwala','Punjab'),('Chishtian','Punjab'),('Mian Channu','Punjab'),('Arifwala','Punjab'),('Kot Addu','Punjab'),
 ('Taxila','Punjab'),('Murree','Punjab'),('Gujar Khan','Punjab'),('Kharian','Punjab'),('Sambrial','Punjab'),
 ('Pasrur','Punjab'),('Nankana Sahib','Punjab'),('Haroonabad','Punjab'),('Ahmedpur East','Punjab'),('Jauharabad','Punjab'),
 ('Khushab','Punjab'),('Fort Abbas','Punjab'),('Shorkot','Punjab'),('Kabirwala','Punjab'),('Dunyapur','Punjab'),
 ('Shakargarh','Punjab'),('Chunian','Punjab'),('Pattoki','Punjab'),('Ferozwala','Punjab'),('Rajanpur','Punjab'),
 ('Jampur','Punjab'),('Taunsa','Punjab'),('Pind Dadan Khan','Punjab'),('Talagang','Punjab'),('Kallar Syedan','Punjab'),
 -- Sindh
 ('Karachi','Sindh'),('Hyderabad','Sindh'),('Sukkur','Sindh'),('Larkana','Sindh'),('Nawabshah','Sindh'),
 ('Mirpur Khas','Sindh'),('Jacobabad','Sindh'),('Shikarpur','Sindh'),('Khairpur','Sindh'),('Dadu','Sindh'),
 ('Thatta','Sindh'),('Badin','Sindh'),('Tando Allahyar','Sindh'),('Tando Muhammad Khan','Sindh'),('Umerkot','Sindh'),
 ('Sanghar','Sindh'),('Ghotki','Sindh'),('Kandhkot','Sindh'),('Kotri','Sindh'),('Jamshoro','Sindh'),
 ('Mithi','Sindh'),('Matiari','Sindh'),('Naushahro Feroze','Sindh'),('Kashmore','Sindh'),('Moro','Sindh'),
 ('Rohri','Sindh'),('Sehwan','Sindh'),('Digri','Sindh'),('Kunri','Sindh'),('Hala','Sindh'),
 ('Tando Adam','Sindh'),('Shahdadpur','Sindh'),('Daharki','Sindh'),('Gambat','Sindh'),('Mehar','Sindh'),
 ('Ratodero','Sindh'),('Shahdadkot','Sindh'),
 -- Khyber Pakhtunkhwa
 ('Peshawar','Khyber Pakhtunkhwa'),('Mardan','Khyber Pakhtunkhwa'),('Mingora','Khyber Pakhtunkhwa'),
 ('Abbottabad','Khyber Pakhtunkhwa'),('Kohat','Khyber Pakhtunkhwa'),('Dera Ismail Khan','Khyber Pakhtunkhwa'),
 ('Bannu','Khyber Pakhtunkhwa'),('Swabi','Khyber Pakhtunkhwa'),('Charsadda','Khyber Pakhtunkhwa'),
 ('Nowshera','Khyber Pakhtunkhwa'),('Mansehra','Khyber Pakhtunkhwa'),('Haripur','Khyber Pakhtunkhwa'),
 ('Lakki Marwat','Khyber Pakhtunkhwa'),('Tank','Khyber Pakhtunkhwa'),('Karak','Khyber Pakhtunkhwa'),
 ('Hangu','Khyber Pakhtunkhwa'),('Timergara','Khyber Pakhtunkhwa'),('Chitral','Khyber Pakhtunkhwa'),
 ('Dir','Khyber Pakhtunkhwa'),('Batkhela','Khyber Pakhtunkhwa'),('Havelian','Khyber Pakhtunkhwa'),
 ('Parachinar','Khyber Pakhtunkhwa'),('Khar','Khyber Pakhtunkhwa'),('Daggar','Khyber Pakhtunkhwa'),
 ('Alpuri','Khyber Pakhtunkhwa'),('Battagram','Khyber Pakhtunkhwa'),('Dassu','Khyber Pakhtunkhwa'),
 ('Malakand','Khyber Pakhtunkhwa'),
 -- Balochistan
 ('Quetta','Balochistan'),('Gwadar','Balochistan'),('Turbat','Balochistan'),('Khuzdar','Balochistan'),
 ('Chaman','Balochistan'),('Hub','Balochistan'),('Sibi','Balochistan'),('Zhob','Balochistan'),
 ('Loralai','Balochistan'),('Dera Murad Jamali','Balochistan'),('Dera Allah Yar','Balochistan'),
 ('Kalat','Balochistan'),('Mastung','Balochistan'),('Nushki','Balochistan'),('Panjgur','Balochistan'),
 ('Pishin','Balochistan'),('Qila Saifullah','Balochistan'),('Usta Muhammad','Balochistan'),
 ('Kharan','Balochistan'),('Uthal','Balochistan'),('Bela','Balochistan'),('Dalbandin','Balochistan'),
 ('Ziarat','Balochistan'),('Kohlu','Balochistan'),('Barkhan','Balochistan'),('Qila Abdullah','Balochistan'),
 ('Awaran','Balochistan'),
 -- Islamabad Capital Territory
 ('Islamabad','Islamabad'),
 -- Gilgit-Baltistan
 ('Gilgit','Gilgit-Baltistan'),('Skardu','Gilgit-Baltistan'),('Karimabad (Hunza)','Gilgit-Baltistan'),
 ('Chilas','Gilgit-Baltistan'),('Khaplu','Gilgit-Baltistan'),('Gahkuch','Gilgit-Baltistan'),
 ('Astore','Gilgit-Baltistan'),('Shigar','Gilgit-Baltistan'),('Aliabad','Gilgit-Baltistan'),
 -- Azad Jammu & Kashmir
 ('Muzaffarabad','Azad Kashmir'),('Mirpur','Azad Kashmir'),('Kotli','Azad Kashmir'),('Bagh','Azad Kashmir'),
 ('Rawalakot','Azad Kashmir'),('Bhimber','Azad Kashmir'),('Hattian Bala','Azad Kashmir'),
 ('Pallandri','Azad Kashmir'),('Dadyal','Azad Kashmir'),('Athmuqam','Azad Kashmir'),('Kahuta (Haveli)','Azad Kashmir')
on conflict (lower(name), province) do nothing;

-- ---------------------------------------------------- anonymous daily totals
-- city_id 0 = "Other" (the player did not pick a city, or it is not listed).
create table if not exists public.habit_daily (
  day date not null,
  city_id int not null default 0,
  gender text not null check (gender in ('female','male','unsaid')),
  rounds int not null default 0,
  score_sum bigint not null default 0,
  q1 bigint not null default 0, q2 bigint not null default 0, q3 bigint not null default 0, q4 bigint not null default 0,
  q5 bigint not null default 0, q6 bigint not null default 0, q7 bigint not null default 0, q8 bigint not null default 0,
  primary key (day, city_id, gender)
);
alter table public.habit_daily enable row level security;

create table if not exists public.habit_events_daily (
  day date not null,
  event text not null check (event in ('visit','start','complete','returning','share','doctor_tap','channel_tap')),
  n bigint not null default 0,
  primary key (day, event)
);
alter table public.habit_events_daily enable row level security;

-- Published weekly winners (a snapshot, so later numbers never rewrite history).
create table if not exists public.habit_winners (
  week_start date primary key,
  best_city_id int,
  best_city_name text,
  best_province text,
  best_score numeric(6,1),
  best_prev_score numeric(6,1),
  improved_city_id int,
  improved_city_name text,
  improved_province text,
  improved_delta numeric(6,1),
  improved_score numeric(6,1),
  min_entries_used int not null,
  published_at timestamptz not null default now()
);
alter table public.habit_winners enable row level security;

-- ------------------------------------------------------------ small helpers
create or replace function public.habit_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Karachi')::date
$$;

-- Monday of the Pakistan week that contains "now" (weeks run Monday-Sunday).
create or replace function public.habit_week_start(p_day date default null)
returns date language sql stable as $$
  select date_trunc('week', coalesce(p_day, (now() at time zone 'Asia/Karachi')::date)::timestamp)::date
$$;

-- Average score per city for days p_from <= day < p_to. Internal.
create or replace function public.habit_range_stats(p_from date, p_to date)
returns table (city_id int, name text, province text, entries bigint, avg_score numeric)
language sql stable security definer set search_path = public as $$
  select d.city_id, c.name, c.province, sum(d.rounds)::bigint,
         sum(d.score_sum)::numeric / nullif(sum(d.rounds), 0)
  from public.habit_daily d
  join public.habit_cities c on c.id = d.city_id
  where d.city_id > 0 and d.day >= p_from and d.day < p_to
  group by d.city_id, c.name, c.province
$$;

-- Works out the two winners for the Monday-Sunday week starting p_week.
create or replace function public.habit_compute_winners(p_week date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_min int;
  v_best record;
  v_imp record;
begin
  select min_entries into v_min from public.habit_settings where id = 1;
  v_min := coalesce(v_min, 100);

  select cur.city_id, cur.name, cur.province, cur.avg_score, cur.entries, prev.avg_score as prev_avg
    into v_best
  from public.habit_range_stats(p_week, p_week + 7) cur
  left join public.habit_range_stats(p_week - 7, p_week) prev on prev.city_id = cur.city_id
  where cur.entries >= v_min
  order by cur.avg_score desc, cur.entries desc, cur.name
  limit 1;

  select cur.city_id, cur.name, cur.province, cur.avg_score, cur.entries,
         (cur.avg_score - prev.avg_score) as delta
    into v_imp
  from public.habit_range_stats(p_week, p_week + 7) cur
  join public.habit_range_stats(p_week - 7, p_week) prev on prev.city_id = cur.city_id
  where cur.entries >= v_min and prev.entries >= v_min and cur.avg_score > prev.avg_score
  order by (cur.avg_score - prev.avg_score) desc, cur.entries desc, cur.name
  limit 1;

  return jsonb_build_object(
    'week_start', p_week,
    'min_entries', v_min,
    'best', case when v_best.city_id is null then null else jsonb_build_object(
      'city_id', v_best.city_id, 'name', v_best.name, 'province', v_best.province,
      'score', round(v_best.avg_score, 1),
      'prev_score', case when v_best.prev_avg is null then null else round(v_best.prev_avg, 1) end) end,
    'improved', case when v_imp.city_id is null then null else jsonb_build_object(
      'city_id', v_imp.city_id, 'name', v_imp.name, 'province', v_imp.province,
      'score', round(v_imp.avg_score, 1), 'delta', round(v_imp.delta, 1)) end
  );
end $$;

-- Writes a snapshot of the winners for a finished week. Internal.
create or replace function public.habit_store_winners(p_week date)
returns boolean language plpgsql security definer set search_path = public as $$
declare w jsonb;
begin
  w := public.habit_compute_winners(p_week);
  if (w->>'best') is null and (w->>'improved') is null then
    return false;
  end if;
  insert into public.habit_winners (
    week_start, best_city_id, best_city_name, best_province, best_score, best_prev_score,
    improved_city_id, improved_city_name, improved_province, improved_delta, improved_score, min_entries_used)
  values (
    p_week,
    nullif(w#>>'{best,city_id}','')::int, w#>>'{best,name}', w#>>'{best,province}',
    nullif(w#>>'{best,score}','')::numeric, nullif(w#>>'{best,prev_score}','')::numeric,
    nullif(w#>>'{improved,city_id}','')::int, w#>>'{improved,name}', w#>>'{improved,province}',
    nullif(w#>>'{improved,delta}','')::numeric, nullif(w#>>'{improved,score}','')::numeric,
    (w->>'min_entries')::int)
  on conflict (week_start) do nothing;
  return true;
end $$;

-- ------------------------------------------------- server-only: record data
-- One finished quiz round. Called only by the website's API route
-- (service_role) after it has validated and rate-limited the request.
create or replace function public.habit_submit(
  p_city_id int, p_gender text, p_answers int[], p_returning boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_live boolean;
  v_city int := 0;
  v_sum int := 0;
  v_score int;
  v_day date := (now() at time zone 'Asia/Karachi')::date;
  i int;
begin
  select game_live into v_live from public.habit_settings where id = 1;
  if not coalesce(v_live, true) then raise exception 'game_off'; end if;
  if p_gender is null or p_gender not in ('female','male','unsaid') then raise exception 'bad_gender'; end if;
  if p_answers is null or array_length(p_answers, 1) is distinct from 8 then raise exception 'bad_answers'; end if;
  for i in 1..8 loop
    if p_answers[i] is null or p_answers[i] < 0 or p_answers[i] > 3 then raise exception 'bad_answers'; end if;
    v_sum := v_sum + p_answers[i];
  end loop;
  if coalesce(p_city_id, 0) > 0 then
    if exists (select 1 from public.habit_cities where id = p_city_id and is_active) then
      v_city := p_city_id;
    end if;
  end if;
  v_score := round(v_sum * 100.0 / 24);

  insert into public.habit_daily as d (day, city_id, gender, rounds, score_sum, q1, q2, q3, q4, q5, q6, q7, q8)
  values (v_day, v_city, p_gender, 1, v_score, p_answers[1], p_answers[2], p_answers[3], p_answers[4],
          p_answers[5], p_answers[6], p_answers[7], p_answers[8])
  on conflict (day, city_id, gender) do update set
    rounds = d.rounds + 1, score_sum = d.score_sum + excluded.score_sum,
    q1 = d.q1 + excluded.q1, q2 = d.q2 + excluded.q2, q3 = d.q3 + excluded.q3, q4 = d.q4 + excluded.q4,
    q5 = d.q5 + excluded.q5, q6 = d.q6 + excluded.q6, q7 = d.q7 + excluded.q7, q8 = d.q8 + excluded.q8;

  insert into public.habit_events_daily as e (day, event, n) values (v_day, 'complete', 1)
    on conflict (day, event) do update set n = e.n + 1;
  if coalesce(p_returning, false) then
    insert into public.habit_events_daily as e (day, event, n) values (v_day, 'returning', 1)
      on conflict (day, event) do update set n = e.n + 1;
  end if;

  return jsonb_build_object('score', v_score, 'city_id', v_city);
end $$;

-- A simple counter (visit, start, share, doctor_tap, channel_tap).
create or replace function public.habit_event(p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_event is null or p_event not in ('visit','start','share','doctor_tap','channel_tap') then
    raise exception 'bad_event';
  end if;
  insert into public.habit_events_daily as e (day, event, n) values (v_day, p_event, 1)
    on conflict (day, event) do update set n = e.n + 1;
end $$;

-- -------------------------------------------------------- public (read only)
-- City league for the last 7 days, compared with the 7 days before.
create or replace function public.habit_public_league()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.habit_settings;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_cities jsonb;
begin
  select * into s from public.habit_settings where id = 1;
  if not found then
    return jsonb_build_object('game_live', true, 'league_live', false, 'show_counts', false, 'min_entries', 100, 'cities', '[]'::jsonb);
  end if;
  if not s.game_live then
    return jsonb_build_object('game_live', false, 'league_live', false, 'show_counts', false, 'min_entries', s.min_entries, 'cities', '[]'::jsonb);
  end if;
  if s.league_live then
    select coalesce(jsonb_agg(x order by (x->>'avg')::numeric desc, x->>'name'), '[]'::jsonb) into v_cities
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'city_id', cur.city_id, 'name', cur.name, 'province', cur.province,
        'avg', round(cur.avg_score, 1),
        'prev_avg', round(prev.avg_score, 1),
        'delta', round(cur.avg_score - prev.avg_score, 1),
        'entries', case when s.show_counts then cur.entries else null end)) as x
      from public.habit_range_stats(v_today - 6, v_today + 1) cur
      left join public.habit_range_stats(v_today - 13, v_today - 6) prev on prev.city_id = cur.city_id
    ) q;
  else
    v_cities := '[]'::jsonb;
  end if;
  return jsonb_build_object('game_live', true, 'league_live', s.league_live, 'show_counts', s.show_counts,
                            'min_entries', s.min_entries, 'cities', v_cities);
end $$;

-- Published winners, newest first. If the admin has switched on automatic
-- publishing, the last finished week is published the first time anyone
-- asks for it.
create or replace function public.habit_public_winners(p_limit int default 8)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s public.habit_settings;
  v_last date := public.habit_week_start() - 7;
begin
  select * into s from public.habit_settings where id = 1;
  if not found or not s.game_live or not s.league_live then return '[]'::jsonb; end if;
  if s.auto_publish and not exists (select 1 from public.habit_winners where week_start = v_last) then
    perform public.habit_store_winners(v_last);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'week_start', w.week_start,
      'best', case when w.best_city_name is null then null else jsonb_build_object(
        'name', w.best_city_name, 'province', w.best_province, 'score', w.best_score, 'prev_score', w.best_prev_score) end,
      'improved', case when w.improved_city_name is null then null else jsonb_build_object(
        'name', w.improved_city_name, 'province', w.improved_province, 'delta', w.improved_delta, 'score', w.improved_score) end
    )) order by w.week_start desc)
    from (select * from public.habit_winners order by week_start desc limit greatest(1, least(coalesce(p_limit, 8), 52))) w
  ), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------- admin
create or replace function public.habit_admin_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.habit_settings;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  select * into s from public.habit_settings where id = 1;
  return jsonb_build_object('game_live', s.game_live, 'league_live', s.league_live, 'show_counts', s.show_counts,
                            'min_entries', s.min_entries, 'auto_publish', s.auto_publish);
end $$;

create or replace function public.habit_admin_save(
  p_game_live boolean, p_league_live boolean, p_show_counts boolean, p_min_entries int, p_auto_publish boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_min_entries is null or p_min_entries < 1 or p_min_entries > 1000000 then raise exception 'bad_min_entries'; end if;
  update public.habit_settings set
    game_live = coalesce(p_game_live, game_live),
    league_live = coalesce(p_league_live, league_live),
    show_counts = coalesce(p_show_counts, show_counts),
    min_entries = p_min_entries,
    auto_publish = coalesce(p_auto_publish, auto_publish),
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.habit_admin_stats(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_from date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  p_days := greatest(1, least(coalesce(p_days, 7), 365));
  v_from := v_today - (p_days - 1);
  return jsonb_build_object(
    'from', v_from, 'to', v_today,
    'events', coalesce((
      select jsonb_object_agg(event, n)
      from (select event, sum(n) as n from public.habit_events_daily where day between v_from and v_today group by event) e
    ), '{}'::jsonb),
    'cities', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.entries desc, c.name)
      from (
        select d.city_id,
               coalesce(ci.name, 'Other (no city picked)') as name,
               coalesce(ci.province, '') as province,
               sum(d.rounds)::bigint as entries,
               round(sum(d.score_sum)::numeric / nullif(sum(d.rounds), 0), 1) as avg_score,
               coalesce(sum(d.rounds) filter (where d.gender = 'female'), 0)::bigint as female,
               coalesce(sum(d.rounds) filter (where d.gender = 'male'), 0)::bigint as male,
               coalesce(sum(d.rounds) filter (where d.gender = 'unsaid'), 0)::bigint as unsaid
        from public.habit_daily d
        left join public.habit_cities ci on ci.id = d.city_id
        where d.day between v_from and v_today
        group by d.city_id, ci.name, ci.province
      ) c
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'completes', n) order by day)
      from public.habit_events_daily where event = 'complete' and day between v_from and v_today
    ), '[]'::jsonb)
  );
end $$;

-- Draft winners for a finished week (default: the last finished week).
create or replace function public.habit_admin_winner_draft(p_week date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_week date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  v_week := coalesce(p_week, public.habit_week_start() - 7);
  return public.habit_compute_winners(v_week)
    || jsonb_build_object('published', exists (select 1 from public.habit_winners where week_start = v_week));
end $$;

create or replace function public.habit_admin_publish_winners(p_week date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_week is null or p_week <> public.habit_week_start(p_week) then raise exception 'week_must_be_a_monday'; end if;
  if p_week >= public.habit_week_start() then raise exception 'week_not_finished'; end if;
  if exists (select 1 from public.habit_winners where week_start = p_week) then raise exception 'already_published'; end if;
  if not public.habit_store_winners(p_week) then raise exception 'no_city_reached_minimum'; end if;
end $$;

create or replace function public.habit_admin_unpublish_winners(p_week date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  delete from public.habit_winners where week_start = p_week;
end $$;

-- -------------------------------------------------------------- permissions
revoke all on function public.habit_today() from public;
revoke all on function public.habit_week_start(date) from public;
revoke all on function public.habit_range_stats(date, date) from public, anon, authenticated;
revoke all on function public.habit_compute_winners(date) from public, anon, authenticated;
revoke all on function public.habit_store_winners(date) from public, anon, authenticated;
revoke all on function public.habit_submit(int, text, int[], boolean) from public, anon, authenticated;
revoke all on function public.habit_event(text) from public, anon, authenticated;
revoke all on function public.habit_public_league() from public;
revoke all on function public.habit_public_winners(int) from public;
revoke all on function public.habit_admin_get() from public, anon;
revoke all on function public.habit_admin_save(boolean, boolean, boolean, int, boolean) from public, anon;
revoke all on function public.habit_admin_stats(int) from public, anon;
revoke all on function public.habit_admin_winner_draft(date) from public, anon;
revoke all on function public.habit_admin_publish_winners(date) from public, anon;
revoke all on function public.habit_admin_unpublish_winners(date) from public, anon;

grant execute on function public.habit_today() to anon, authenticated, service_role;
grant execute on function public.habit_week_start(date) to anon, authenticated, service_role;
grant execute on function public.habit_submit(int, text, int[], boolean) to service_role;
grant execute on function public.habit_event(text) to service_role;
grant execute on function public.habit_public_league() to anon, authenticated, service_role;
grant execute on function public.habit_public_winners(int) to anon, authenticated, service_role;
grant execute on function public.habit_admin_get() to authenticated;
grant execute on function public.habit_admin_save(boolean, boolean, boolean, int, boolean) to authenticated;
grant execute on function public.habit_admin_stats(int) to authenticated;
grant execute on function public.habit_admin_winner_draft(date) to authenticated;
grant execute on function public.habit_admin_publish_winners(date) to authenticated;
grant execute on function public.habit_admin_unpublish_winners(date) to authenticated;
