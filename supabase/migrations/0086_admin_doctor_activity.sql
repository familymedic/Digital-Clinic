-- 0086: admin view of doctor inactivity.
--
-- Doctors now pay once and keep access, so the admin needs a way to spot
-- doctors who have gone quiet and remove them (Deactivate on /admin/doctors).
-- Two flags, both worked out here so the rule lives in one place:
--   * no_consultation_3m  - no booked consultation (status submitted or
--                           completed) in the last 3 months. A doctor who
--                           has never had one is measured from the later
--                           of "joined" and "paid the fee".
--   * not_logged_in_4d    - no sign-in or session activity in 4 days.
--                           Uses the later of the last sign-in and the most
--                           recent session refresh (a doctor who stays
--                           signed in on their phone still counts).
-- Read-only, admin only, approved + active doctors only. Nothing is changed
-- or removed automatically - the admin decides.

create or replace function public.admin_doctor_activity()
returns table (
  doctor_id uuid,
  last_consultation_at timestamptz,
  last_login_at timestamptz,
  baseline_at timestamptz,
  no_consultation_3m boolean,
  not_logged_in_4d boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_profiles a where a.id = auth.uid()) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;

  return query
  with last_consult as (
    select c.doctor_id as did, max(c.created_at) as at
    from public.consultations c
    where c.status in ('submitted', 'completed') and c.doctor_id is not null
    group by c.doctor_id
  ),
  last_login as (
    select u.id as did, u.last_sign_in_at as at from auth.users u
  ),
  base as (
    select d.id as did,
           lc.at as consult_at,
           greatest(ll.at, (select max(s.updated_at) from auth.sessions s where s.user_id = d.id)) as login_at,
           greatest(d.created_at, coalesce(d.subscription_started_at, d.created_at)) as baseline
    from public.doctor_profiles d
    left join last_consult lc on lc.did = d.id
    left join last_login ll on ll.did = d.id
    where d.verification_status = 'approved' and d.is_active
  )
  select b.did,
         b.consult_at,
         b.login_at,
         b.baseline,
         coalesce(b.consult_at, b.baseline) < now() - interval '3 months',
         coalesce(b.login_at, b.baseline) < now() - interval '4 days'
  from base b;
end;
$$;

revoke all on function public.admin_doctor_activity() from public, anon;
grant execute on function public.admin_doctor_activity() to authenticated, service_role;
