-- Family packages, part 5: "doctors offering a Family Pack" list (2026-10-26).
--
-- One read-only function so the Our Doctors page can show a "Family Pack" tab
-- and a small badge on each doctor's card WITHOUT opening every doctor.
-- It follows exactly the same rules as package_public_for_doctor (0088):
--   * the master switch "Sales open to the public" is ON
--   * the doctor's pack is active (a paused / draft / archived pack is not listed)
--   * the doctor is publicly listed
--   * the pack is not full
-- It returns only what a badge needs: how many consultations, how many people,
-- which ways (text / audio / video) and how many days. NO price (the price is
-- shown on the doctor's own page). It changes nothing.
--
-- ROLLBACK: ROLLBACK-0092.sql

create or replace function public.package_list_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open boolean;
begin
  select sales_open into v_open from public.family_package_settings where id;
  if not coalesce(v_open, false) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'doctor_id', pk.doctor_id,
      'consultations_total', pk.consultations_total,
      'members_allowed', pk.members_allowed,
      'allow_text', pk.allow_text,
      'allow_audio', pk.allow_audio,
      'allow_video', pk.allow_video,
      'validity_days', pk.validity_days
    ))
    from public.family_packages pk
    where pk.status = 'active'
      and exists (select 1 from public.public_doctor_directory d where d.id = pk.doctor_id)
      and (pk.max_families is null
           or public.package_active_families(pk.doctor_id) < pk.max_families)
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.package_list_offers() to anon, authenticated;
