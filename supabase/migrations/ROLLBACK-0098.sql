-- Undo 0098 (service areas). Afterwards re-run 0095_locator.sql and 0097_locator_pharmacy_hours_doctor_clinics.sql
-- (both safe to re-run) to put the Karachi-only search / counts / apply / suggest / doctor-clinic functions back.
-- Places keep the city label they have now.
drop trigger if exists locator_places_set_city_trg on public.locator_places;
drop function if exists public.locator_places_set_city();
drop function if exists public.locator_counts(text);
drop function if exists public.locator_regions_public();
drop function if exists public.locator_city_for(double precision, double precision);
drop table if exists public.locator_regions;
