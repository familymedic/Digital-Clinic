-- Undo 0100 (vaccination centres). WARNING: deletes every vaccination centre and every upload record.
-- Export them first if you want to keep them.
-- AFTER running this file, re-run 0096, 0097, 0098 and 0099 IN THAT ORDER (each is safe to repeat):
-- they put back the original search, counts, directions, tracker and rule definitions.
drop function if exists public.locator_admin_vacc_undo(uuid);
drop function if exists public.locator_admin_vacc_update(uuid, jsonb);
drop function if exists public.locator_admin_vacc_import(jsonb, boolean, text);
drop function if exists public.locator_vacc_check(jsonb);
drop function if exists public.locator_directions_target_quiet(uuid);
drop function if exists public.locator_search(double precision, double precision, numeric, text, text);

delete from public.locator_places where category = 'vaccination';
delete from public.locator_events_daily where category = 'vaccination' or event = 'share';
delete from public.locator_search_areas_daily where category = 'vaccination';
drop table if exists public.locator_import_batches;

alter table public.locator_places drop constraint if exists locator_places_vaccination_check;
alter table public.locator_places drop column if exists district, drop column if exists vaccines,
  drop column if exists source_note, drop column if exists last_verified, drop column if exists import_batch;

alter table public.locator_places drop constraint if exists locator_places_category_check;
alter table public.locator_places add constraint locator_places_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism'));
alter table public.locator_places drop constraint if exists locator_places_kind_check;
alter table public.locator_places add constraint locator_places_kind_check
  check (kind in (
    'clinic', 'doctor', 'hospital', 'lab', 'pharmacy', 'therapy',
    'rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology',
    'school', 'barber', 'salon', 'restaurant', 'cafe', 'market', 'park', 'mall', 'other'));
alter table public.locator_events_daily drop constraint if exists locator_events_daily_category_check;
alter table public.locator_events_daily add constraint locator_events_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism', 'none'));
alter table public.locator_search_areas_daily drop constraint if exists locator_search_areas_daily_category_check;
alter table public.locator_search_areas_daily add constraint locator_search_areas_daily_category_check
  check (category in ('doctor', 'pharmacy', 'therapy', 'autism'));
alter table public.locator_events_daily drop constraint if exists locator_events_daily_event_check;
alter table public.locator_events_daily add constraint locator_events_daily_event_check
  check (event in ('search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap',
                   'gps_denied', 'coming_soon', 'waitlist', 'suggest', 'apply', 'pay_start', 'paid', 'report', 'widen'));
