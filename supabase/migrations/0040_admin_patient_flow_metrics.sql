-- Requested directly by the physician (2026-09-18) alongside a go-live
-- readiness check: "add number of Families and number of patients
-- registered on the website so we know the patient flow as well" —
-- extending the existing /admin/metrics page (0036) with registration
-- volume, not just traffic/revenue.
--
-- "Families" = distinct account holders (one auth.users login that can
-- book for several people); "patients" = every individual person who
-- can receive care (every family_members row: the account holder's own
-- "self" row plus every family member they've added). These are
-- deliberately different numbers — one household/account can contain
-- several patients — and both matter for reading patient flow.
--
-- A real gotcha, confirmed by re-reading the Phase 4b signup trigger's
-- own commentary (0003) and the Phase 7 doctor-dashboard notes (0015):
-- EVERY account gets an auto-created "self" family_members row on
-- signup, including a doctor's or admin's own login — there being no
-- separate signup path for staff. Counting family_members directly
-- would silently inflate "patients registered" by every doctor and
-- admin account (including the physician's own test/admin accounts),
-- which is exactly the kind of number a real doctor could act on
-- believing it's genuine patient volume. This function excludes any
-- account_id that also appears in doctor_profiles or admin_profiles.
--
-- No blanket admin SELECT policy on family_members was added for this
-- (that table holds patient names and dates of birth for the whole
-- platform — real PII an admin dashboard has no reason to bulk-read
-- just to show two counts). Instead, same "expose only what's needed"
-- pattern as public_doctor_directory (0028) and cancel_consultation
-- (0037): a security-definer function that returns only account_id,
-- relationship, and created_at — enough for the admin page to compute
-- its own today/7-day/30-day windows exactly the way it already does
-- for page views, consultations, and payments — never a name or DOB.

create or replace function public.admin_patient_flow_rows()
returns table (
  account_id uuid,
  relationship text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Not authorized.';
  end if;

  return query
  select fm.account_id, fm.relationship, fm.created_at
  from public.family_members fm
  where not exists (select 1 from public.doctor_profiles dp where dp.id = fm.account_id)
    and not exists (select 1 from public.admin_profiles ap where ap.id = fm.account_id);
end;
$$;

grant execute on function public.admin_patient_flow_rows() to authenticated;
