-- Undo 0097. Afterwards re-run 0096_locator_listings.sql (it is safe to re-run) to put the
-- earlier search / apply / summary / counter functions back.
-- Doctor-added clinics are kept: they become ordinary owner listings (still linked to the doctor).
drop function if exists public.locator_doctor_status();
drop function if exists public.locator_doctor_my_places();
drop function if exists public.locator_doctor_save_place(uuid, text, text, text, text, text, double precision, double precision, jsonb, boolean);
drop function if exists public.locator_doctor_remove_place(uuid);
drop function if exists public.locator_doctor_checkout_info(uuid, uuid);
drop function if exists public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean, jsonb);
drop function if exists public.locator_search(double precision, double precision, numeric, text, text);

alter table public.locator_places drop constraint if exists locator_places_pharmacy_check;
update public.locator_places set category = 'doctor' where category = 'pharmacy';
update public.locator_places set source = 'owner' where source = 'doctor';
delete from public.locator_search_areas_daily where category = 'pharmacy';
update public.locator_events_daily set category = 'none' where category = 'pharmacy';

alter table public.locator_places drop constraint if exists locator_places_hours_check;
alter table public.locator_places drop column if exists hours;
drop function if exists public.locator_hours_ok(jsonb);
