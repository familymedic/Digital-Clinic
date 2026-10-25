-- Rollback for 0087 (Habit Age league minimum + Today/7/30 views).
-- Puts back the 0084 versions of the league and the admin settings functions.
drop function if exists public.habit_admin_views();
drop function if exists public.habit_admin_save(boolean, boolean, boolean, int, boolean, int);

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
revoke all on function public.habit_admin_save(boolean, boolean, boolean, int, boolean) from public, anon;
grant execute on function public.habit_admin_save(boolean, boolean, boolean, int, boolean) to authenticated;

alter table public.habit_settings drop column if exists league_min_entries;
