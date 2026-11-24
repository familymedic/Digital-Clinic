-- Undo 0101 (vaccine type + service fee). Private-only centres are deleted (they have no place in 0100's single list);
-- centres that give the government vaccine stay.
-- AFTER running this file, run 0100_locator_vaccination.sql again (safe to repeat): it puts back the 0100 versions of the
-- search, counts, row checker and upload functions.
delete from public.locator_places where category = 'vaccination' and vaccine_type = 'private';
alter table public.locator_places drop constraint if exists locator_places_vaccine_type_rule;
alter table public.locator_places drop constraint if exists locator_places_vaccine_type_check;
alter table public.locator_places drop column if exists vaccine_type, drop column if exists service_fee;
