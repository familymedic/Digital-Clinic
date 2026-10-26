-- Undo 0093: the flyer maker then works for every doctor (the page treats a missing switch as ON).
drop function if exists public.admin_package_set_flyer(boolean);
drop function if exists public.package_flyer_enabled();
alter table public.family_package_settings drop column if exists flyer_enabled;
