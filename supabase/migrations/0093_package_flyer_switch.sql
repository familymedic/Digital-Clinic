-- Family packages, part 6: on/off switch for the doctors' pack flyer (2026-10-26).
--
-- The flyer itself is drawn in the doctor's browser and stores nothing. This only
-- adds one admin switch so Family Medic can turn the flyer maker off for every
-- doctor at once (for example while PMDC advertising rules are being checked).
-- Default is ON. Nothing else changes.
--
-- ROLLBACK: ROLLBACK-0093.sql

alter table public.family_package_settings
  add column if not exists flyer_enabled boolean not null default true;

create or replace function public.package_flyer_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select flyer_enabled from public.family_package_settings where id), true);
$$;

grant execute on function public.package_flyer_enabled() to authenticated;

create or replace function public.admin_package_set_flyer(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  update public.family_package_settings set flyer_enabled = coalesce(p_on, true), updated_at = now() where id;
end;
$$;

grant execute on function public.admin_package_set_flyer(boolean) to authenticated;
