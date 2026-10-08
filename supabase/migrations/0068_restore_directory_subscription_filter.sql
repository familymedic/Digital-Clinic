-- 0068: put the "must have paid" rule back on the public doctor directory.
-- 2026-10-08.
--
-- Migration 0067 (doctor credentials) recreated public_doctor_directory
-- without the subscription conditions that 0043/0044 had added, so
-- approved doctors who had NOT paid started appearing on Our Doctors.
-- This recreates the view with every column in the same order as 0067
-- (credentials last) AND the paid-up, not-expired conditions.
-- Safe to run more than once. Safe whether or not 0067 has been run:
-- if the doctor_credentials table is missing it is created empty below.

create table if not exists public.doctor_credentials (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  credential text not null,
  detail text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'removed')),
  evidence_path text,
  rejection_reason text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);

-- Lock the table down immediately (same rules as 0067). If 0067 already ran
-- these are harmless repeats; if it did not, this stops the table ever being
-- readable through the public API. Doctors never write it directly.
alter table public.doctor_credentials enable row level security;

drop policy if exists "Doctors can view their own credentials" on public.doctor_credentials;
create policy "Doctors can view their own credentials"
  on public.doctor_credentials for select
  using (doctor_id = auth.uid());

drop policy if exists "Admins can view all credentials" on public.doctor_credentials;
create policy "Admins can view all credentials"
  on public.doctor_credentials for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update credentials" on public.doctor_credentials;
create policy "Admins can update credentials"
  on public.doctor_credentials for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

create or replace view public.public_doctor_directory as
select
  d.id,
  d.full_name,
  d.specialty,
  d.consultation_fee,
  case when d.profile_status = 'approved' then d.bio end as bio,
  case when d.profile_status = 'approved' then d.years_of_experience end as years_of_experience,
  case when d.profile_status = 'approved' then d.profile_photo_url end as profile_photo_url,
  (
    select string_agg(
      c.credential || case when coalesce(c.detail, '') <> '' then ' (' || c.detail || ')' else '' end,
      ', '
      order by coalesce(
        array_position(
          array['MBBS','BDS','RMP','MD','MS','MDS','MCPS','FCPS','MRCP','FRCP','MRCGP','FRCS']::text[],
          c.credential
        ), 99),
        c.credential
    )
    from public.doctor_credentials c
    where c.doctor_id = d.id and c.status = 'approved'
  ) as credentials
from public.doctor_profiles d
where d.verification_status = 'approved'
  and d.is_active
  and d.fee_status = 'approved'
  and d.subscription_status = 'active'
  and (d.subscription_current_period_end is null or d.subscription_current_period_end > now());

grant select on public.public_doctor_directory to anon, authenticated;

-- Re-assert the booking-side rule from 0044 too (idempotent), so a
-- patient can never be assigned to / book an unpaid doctor either.
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
    where verification_status = 'approved'
      and is_active
      and fee_status = 'approved'
      and subscription_status = 'active'
      and (subscription_current_period_end is null or subscription_current_period_end > now())
    order by created_at asc
    limit 1;
    new.doctor_id := the_doctor;
  else
    select exists (
      select 1 from public.doctor_profiles
      where id = new.doctor_id
        and verification_status = 'approved'
        and is_active
        and fee_status = 'approved'
        and subscription_status = 'active'
        and (subscription_current_period_end is null or subscription_current_period_end > now())
    ) into doctor_is_live;
    if not doctor_is_live then
      raise exception 'The selected doctor is not currently available for booking.';
    end if;
  end if;
  return new;
end;
$$;
