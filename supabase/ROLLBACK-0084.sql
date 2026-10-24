-- Rollback for 0084 (Habit Age game + city league). Removes only what 0084
-- created. All Habit Age counters, winners and the city list are deleted.
drop function if exists public.habit_admin_unpublish_winners(date);
drop function if exists public.habit_admin_publish_winners(date);
drop function if exists public.habit_admin_winner_draft(date);
drop function if exists public.habit_admin_stats(int);
drop function if exists public.habit_admin_save(boolean, boolean, boolean, int, boolean);
drop function if exists public.habit_admin_get();
drop function if exists public.habit_public_winners(int);
drop function if exists public.habit_public_league();
drop function if exists public.habit_event(text);
drop function if exists public.habit_submit(int, text, int[], boolean);
drop function if exists public.habit_store_winners(date);
drop function if exists public.habit_compute_winners(date);
drop function if exists public.habit_range_stats(date, date);
drop function if exists public.habit_week_start(date);
drop function if exists public.habit_today();
drop table if exists public.habit_winners;
drop table if exists public.habit_events_daily;
drop table if exists public.habit_daily;
drop table if exists public.habit_cities;
drop table if exists public.habit_settings;
