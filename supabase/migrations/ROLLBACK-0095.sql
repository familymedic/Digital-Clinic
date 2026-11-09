-- Undo 0095 (Family Medic Locator). WARNING: this deletes every place, waitlist sign-up and
-- usage counter the locator has collected. Export them first if you want to keep them.
drop function if exists public.locator_admin_summary();
drop function if exists public.locator_submit_place(text, text, text, text, text, text, text, double precision, double precision, text, text, boolean);
drop function if exists public.locator_waitlist_add(text, text, text);
drop function if exists public.locator_event(text, text);
drop function if exists public.locator_counts();
drop function if exists public.locator_search(double precision, double precision, numeric, text, text);
drop table if exists public.locator_events_daily;
drop table if exists public.locator_waitlist;
drop table if exists public.locator_places;
drop table if exists public.locator_settings;
