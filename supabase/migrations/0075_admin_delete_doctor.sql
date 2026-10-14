-- Admin "Delete doctor" (2026-10-14). Lets an admin remove a doctor entry that
-- never became a working doctor: someone who registered but didn't continue,
-- was never approved, or never paid. It is deliberately SAFE:
--   * admin-only (raises 'Admins only.' for anyone else)
--   * refuses an admin account
--   * refuses a doctor who has ANY consultation, follow-up, assessment,
--     voucher, payout or patient feedback, or a subscription that is not
--     'unpaid' — those are real records; use Deactivate for them instead
--   * everything happens in one transaction: either all of it is removed or
--     nothing is
--   * leaves a small log row (name, email, PMDC no., who/when) so you can still
--     contact or remember the person afterwards
-- The login account itself is removed by the server route only when the account
-- has no patient-side history (reported back in "remove_login").
--
-- Safe to run twice. Undo: ROLLBACK-0075.sql.

create table if not exists public.doctor_deletion_log (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  full_name text,
  email text,
  specialty text,
  pmdc_number text,
  verification_status text,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

alter table public.doctor_deletion_log enable row level security;

drop policy if exists "Admins can view doctor deletion log" on public.doctor_deletion_log;
create policy "Admins can view doctor deletion log"
  on public.doctor_deletion_log for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

create or replace function public.admin_delete_doctor(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.doctor_profiles%rowtype;
  t text;
  has_rows boolean;
  remove_login boolean := true;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  if exists (select 1 from public.admin_profiles where id = p_id) then
    raise exception 'This account is also an admin account, so it can''t be deleted here.';
  end if;

  select * into d from public.doctor_profiles where id = p_id for update;
  if not found then
    raise exception 'That doctor entry no longer exists.';
  end if;

  -- Real work or money attached? Then this must be Deactivate, not Delete.
  foreach t in array array[
    'consultations', 'consultation_followups', 'consultation_assessments',
    'consultation_followup_vouchers', 'doctor_payouts', 'patient_feedback'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I where doctor_id = $1)', t)
        into has_rows using p_id;
      if has_rows then
        raise exception 'This doctor has consultations, payouts or patient records, so it can''t be deleted. Use Deactivate instead.';
      end if;
    end if;
  end loop;

  if d.subscription_status is distinct from 'unpaid' then
    raise exception 'This doctor has (or had) a paid subscription, so it can''t be deleted. Use Deactivate instead.';
  end if;

  -- The login account is only removed when it has no patient-side history.
  if exists (select 1 from public.family_members where account_id = p_id and relationship <> 'self')
     or (to_regclass('public.payments') is not null
         and exists (select 1 from public.payments where account_id = p_id))
     or exists (
       select 1 from public.consultations c
       join public.family_members f on f.id = c.patient_id
       where f.account_id = p_id) then
    remove_login := false;
  end if;

  insert into public.doctor_deletion_log (doctor_id, full_name, email, specialty, pmdc_number, verification_status, deleted_by)
  values (d.id, d.full_name, d.email, d.specialty, d.pmdc_number, d.verification_status, auth.uid());

  -- Tables that point at the login account (no cascade from the profile).
  delete from public.doctor_subscription_events where doctor_id = p_id;
  delete from public.doctor_availability_slots where doctor_id = p_id;
  delete from public.doctor_text_availability where doctor_id = p_id;
  delete from public.doctor_payout_details where doctor_id = p_id;
  delete from public.doctor_profiles where id = p_id; -- cascades credentials, plans, specialty changes, view events

  return jsonb_build_object(
    'full_name', d.full_name,
    'email', d.email,
    'remove_login', remove_login,
    'pmdc_certificate_path', d.pmdc_certificate_path,
    'cnic_certificate_path', d.cnic_certificate_path
  );
exception
  when foreign_key_violation then
    raise exception 'This doctor is still linked to other records, so it can''t be deleted. Use Deactivate instead.';
end;
$$;

revoke all on function public.admin_delete_doctor(uuid) from public, anon;
grant execute on function public.admin_delete_doctor(uuid) to authenticated;
