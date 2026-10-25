-- 0087: Habit Age - fairer city league + Today / 7 days / 30 days views.
--
-- 1. A city only appears on the public league once it has at least
--    league_min_entries plays in the league window (last 7 days). Default 10.
--    A city with 1 play can no longer top a city with 50. The "arrow vs last
--    week" is shown only when last week also had that many plays.
--    (City of the Week still needs the separate, higher min_entries = 100.)
-- 2. habit_admin_views(): admin-only counts of visits / rounds started /
--    rounds completed for Today, last 7 days and last 30 days (Pakistan dates).
-- Nothing else changes. Rollback: ROLLBACK-0087.sql.

alter table public.habit_settings
  add column if not exists league_min_entries int not null default 10
  check (league_min_entries between 1 and 1000000);

-- 1. public league -----------------------------------------------------------
create or replace function public.habit_public_league()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.habit_settings;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_cities jsonb;
begin
  select * into s from public.habit_settings where id = 1;
  if not found then
    return jsonb_build_object('game_live', true, 'league_live', false, 'show_counts', false, 'min_entries', 100, 'league_min', 10, 'cities', '[]'::jsonb);
  end if;
  if not s.game_live then
    return jsonb_build_object('game_live', false, 'league_live', false, 'show_counts', false, 'min_entries', s.min_entries, 'league_min', s.league_min_entries, 'cities', '[]'::jsonb);
  end if;
  if s.league_live then
    select coalesce(jsonb_agg(x order by (x->>'avg')::numeric desc, x->>'name'), '[]'::jsonb) into v_cities
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'city_id', cur.city_id, 'name', cur.name, 'province', cur.province,
        'avg', round(cur.avg_score, 1),
        'prev_avg', case when prev.entries >= s.league_min_entries then round(prev.avg_score, 1) else null end,
        'delta', case when prev.entries >= s.league_min_entries then round(cur.avg_score - prev.avg_score, 1) else null end,
        'entries', case when s.show_counts then cur.entries else null end)) as x
      from public.habit_range_stats(v_today - 6, v_today + 1) cur
      left join public.habit_range_stats(v_today - 13, v_today - 6) prev on prev.city_id = cur.city_id
      where cur.entries >= s.league_min_entries
    ) q;
  else
    v_cities := '[]'::jsonb;
  end if;
  return jsonb_build_object('game_live', true, 'league_live', s.league_live, 'show_counts', s.show_counts,
                            'min_entries', s.min_entries, 'league_min', s.league_min_entries, 'cities', v_cities);
end $$;

-- admin settings: expose + save the league minimum ---------------------------
create or replace function public.habit_admin_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.habit_settings;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  select * into s from public.habit_settings where id = 1;
  return jsonb_build_object('game_live', s.game_live, 'league_live', s.league_live, 'show_counts', s.show_counts,
                            'min_entries', s.min_entries, 'auto_publish', s.auto_publish,
                            'league_min_entries', s.league_min_entries);
end $$;

drop function if exists public.habit_admin_save(boolean, boolean, boolean, int, boolean);
create or replace function public.habit_admin_save(
  p_game_live boolean, p_league_live boolean, p_show_counts boolean, p_min_entries int, p_auto_publish boolean,
  p_league_min_entries int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  if p_min_entries is null or p_min_entries < 1 or p_min_entries > 1000000 then raise exception 'bad_min_entries'; end if;
  if p_league_min_entries is not null and (p_league_min_entries < 1 or p_league_min_entries > 1000000) then
    raise exception 'bad_league_min';
  end if;
  update public.habit_settings set
    game_live = coalesce(p_game_live, game_live),
    league_live = coalesce(p_league_live, league_live),
    show_counts = coalesce(p_show_counts, show_counts),
    min_entries = p_min_entries,
    auto_publish = coalesce(p_auto_publish, auto_publish),
    league_min_entries = coalesce(p_league_min_entries, league_min_entries),
    updated_at = now()
  where id = 1;
end $$;
revoke all on function public.habit_admin_save(boolean, boolean, boolean, int, boolean, int) from public, anon;
grant execute on function public.habit_admin_save(boolean, boolean, boolean, int, boolean, int) to authenticated;

-- 2. Today / 7 days / 30 days -------------------------------------------------
create or replace function public.habit_admin_views()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then raise exception 'not_admin'; end if;
  return (
    select coalesce(jsonb_object_agg(ev, jsonb_build_object('today', t, 'd7', w, 'd30', m)), '{}'::jsonb)
    from (
      select e.event as ev,
             coalesce(sum(e.n) filter (where e.day = v_today), 0)::bigint as t,
             coalesce(sum(e.n) filter (where e.day >= v_today - 6), 0)::bigint as w,
             coalesce(sum(e.n) filter (where e.day >= v_today - 29), 0)::bigint as m
      from public.habit_events_daily e
      where e.event in ('visit', 'start', 'complete') and e.day >= v_today - 29
      group by e.event
    ) z
  );
end $$;
revoke all on function public.habit_admin_views() from public, anon;
grant execute on function public.habit_admin_views() to authenticated;
