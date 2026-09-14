-- Doctor onboarding, step 3: patient-facing doctor directory + doctor
-- selection at booking. Directly what the physician asked for — "doctor
-- profiles well according to the departments so patients can see and
-- select doctors accordingly" — now that step 1 (self-registration +
-- PMDC review) means more than one live doctor can actually exist.
--
-- Replaces 0015's single-doctor auto-assign stopgap: booking now sets
-- doctor_id explicitly to the doctor the patient chose (or the one
-- they're browsing from /doctors), rather than always picking "whoever
-- was added first." A booking that arrives with no doctor_id at all
-- (e.g. an old client, or a direct API call) still falls back to
-- picking a live doctor automatically, same spirit as before — it just
-- picks from doctors who are actually approved, active, and
-- fee-approved now, not from every row in the table regardless of
-- status.

-- 1. Public doctor directory. Deliberately a VIEW, not a new RLS policy
--    on doctor_profiles itself — the table holds PMDC numbers,
--    certificate paths, and rejection reasons that should never be
--    publicly queryable, and Postgres RLS/column grants can't express
--    "expose only these columns, for these rows, to anyone" without
--    either (a) a view, or (b) column-level REVOKE+GRANT — which is the
--    pattern used elsewhere in this project (0018, 0025, 0026), but
--    would be wrong here specifically because column grants apply to
--    the whole `authenticated` role, and would just as easily strip a
--    doctor's own PMDC number from their own dashboard or an admin's
--    review queue, since Postgres can't tell those apart at the grant
--    level (only RLS policies can, via admin_profiles/id=auth.uid()).
--    A view sidesteps this entirely: it selects only the safe columns,
--    for only live doctors, and that's *all* anyone querying the view
--    can ever see, regardless of their own row's real permissions.
--
--    This view runs with the privileges of its owner (whoever runs this
--    migration) rather than the querying role — deliberate, not an
--    oversight, and the same underlying Postgres mechanism this
--    project's `is_doctor_for_patient` security-definer function
--    already relies on for a different purpose. Supabase's dashboard
--    may flag this as a "Security Definer View" advisory; that's
--    expected here, not a bug — it's exactly how a curated public
--    subset of a protected table is meant to work.
create or replace view public.public_doctor_directory as
select id, full_name, specialty, consultation_fee
from public.doctor_profiles
where verification_status = 'approved' and is_active and fee_status = 'approved';

grant select on public.public_doctor_directory to anon, authenticated;

-- 2. Let a booking specify which doctor it's for. Additive to the
--    existing column-insert grants (0015/0020/0021) — Postgres
--    accumulates column privileges across separate GRANT statements for
--    the same role, it doesn't need to be re-declared alongside the
--    earlier columns.
grant insert (doctor_id) on public.consultations to authenticated;

-- 3. Never trust the client's own claim about which doctor they picked
--    — same principle as every other privileged write in this app. If a
--    doctor_id is supplied, it must resolve to a currently live doctor
--    (approved + active + fee-approved) or the insert is rejected
--    outright, rather than silently booking against a deactivated or
--    still-pending account. If none is supplied at all (the one case
--    this trigger used to always handle), fall back to the earliest
--    live doctor — the same "pick someone rather than leave it null"
--    behavior as before, just scoped to doctors who are actually
--    bookable now that more than one can exist.
create or replace function public.assign_default_doctor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  the_doctor uuid;
  doctor_is_live boolean;
begin
  if new.doctor_id is null then
    select id into the_doctor
    from public.doctor_profiles
    where verification_status = 'approved' and is_active and fee_status = 'approved'
    order by created_at asc
    limit 1;
    new.doctor_id := the_doctor; -- still null if no live doctor exists yet — unchanged, safe behavior
  else
    select exists (
      select 1 from public.doctor_profiles
      where id = new.doctor_id
        and verification_status = 'approved'
        and is_active
        and fee_status = 'approved'
    ) into doctor_is_live;
    if not doctor_is_live then
      raise exception 'The selected doctor is not currently available for booking.';
    end if;
  end if;
  return new;
end;
$$;
