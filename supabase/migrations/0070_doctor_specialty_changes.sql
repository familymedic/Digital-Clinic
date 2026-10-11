-- 0070: doctor specialty change requests — 2026-10-11.
--
-- Physician's rule: a doctor who registered under the wrong specialty, or who
-- has since been certified in a different one, can ask ONCE to change it. An
-- admin approves or rejects. Only an approved request changes the doctor's
-- specialty on their public profile.
--
--   * ONE change per doctor, ever: a partial unique index allows only one
--     APPROVED request per doctor. A REJECTED request does not use up the
--     change — the doctor can ask again.
--   * Only one request can be waiting at a time (second partial unique index).
--   * Doctors never write this table or doctor_profiles directly: requests go
--     through /api/doctors/specialty-change (service role, caller's own row
--     only). Approving is done by review_specialty_change() below, which
--     checks the caller is an admin and changes the request and the doctor's
--     specialty in one step.
--   * Optional proof (e.g. a CPSP certificate) is stored in the existing
--     private "doctor-documents" bucket, same as credential evidence.
--
-- Safe to run more than once. Nothing here changes any existing table.

create table if not exists public.doctor_specialty_changes (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  from_specialty text,
  to_specialty text not null,
  reason text not null,
  evidence_path text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint doctor_specialty_changes_reason_length check (char_length(reason) between 10 and 500),
  constraint doctor_specialty_changes_to_length check (char_length(to_specialty) between 2 and 80)
);

create unique index if not exists doctor_specialty_changes_one_pending_idx
  on public.doctor_specialty_changes (doctor_id) where status = 'pending';
create unique index if not exists doctor_specialty_changes_one_approved_idx
  on public.doctor_specialty_changes (doctor_id) where status = 'approved';
create index if not exists doctor_specialty_changes_status_idx
  on public.doctor_specialty_changes (status, requested_at desc);

alter table public.doctor_specialty_changes enable row level security;

drop policy if exists "Doctors can view their own specialty changes" on public.doctor_specialty_changes;
create policy "Doctors can view their own specialty changes"
  on public.doctor_specialty_changes for select
  using (doctor_id = auth.uid());

drop policy if exists "Admins can view all specialty changes" on public.doctor_specialty_changes;
create policy "Admins can view all specialty changes"
  on public.doctor_specialty_changes for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Approve or reject a request. Admin only. Approving changes the doctor's
-- specialty and marks the request approved in the same transaction.
create or replace function public.review_specialty_change(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.doctor_specialty_changes%rowtype;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Only an admin account can do this.' using errcode = '42501';
  end if;

  select * into v_row from public.doctor_specialty_changes where id = p_request_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  if p_approve then
    update public.doctor_profiles set specialty = v_row.to_specialty where id = v_row.doctor_id;
    update public.doctor_specialty_changes
       set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = null
     where id = p_request_id;
  else
    update public.doctor_specialty_changes
       set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
           rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_request_id;
  end if;
end;
$$;

revoke all on function public.review_specialty_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_specialty_change(uuid, boolean, text) to authenticated;
