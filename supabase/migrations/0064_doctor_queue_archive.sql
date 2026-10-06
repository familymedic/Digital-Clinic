-- Doctor queue: Archive / Restore (2026-10-06).
--
-- A doctor asked to be able to remove old rows from her consultation
-- queue. Consultations are clinical and financial records (payments,
-- payouts and the patient's own history hang off them), so they are NEVER
-- deleted. Instead the doctor can ARCHIVE a row: it disappears from her
-- queue and dashboard counts, stays fully visible to admin and the
-- patient, and can be restored at any time.
--
-- Additive only: one nullable column + one function. Safe to re-run.

alter table public.consultations
  add column if not exists doctor_archived_at timestamptz;

create or replace function public.doctor_archive_consultation(
  p_consultation_id uuid,
  p_archive boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.consultations%rowtype;
  v_slot_start timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row from public.consultations where id = p_consultation_id;
  if not found or v_row.doctor_id is distinct from auth.uid() then
    raise exception 'Consultation not found';
  end if;

  if p_archive then
    -- Only finished or stale work can be archived, so a live booking can
    -- never be hidden by accident:
    --   * completed consultations, or
    --   * anything booked more than 24 hours ago whose scheduled slot
    --     (if any) is already in the past.
    if v_row.status <> 'completed' then
      if v_row.created_at > now() - interval '24 hours' then
        raise exception 'This booking is too recent to archive. Complete it first, or wait 24 hours.';
      end if;
      if v_row.slot_id is not null then
        select start_time into v_slot_start
          from public.doctor_availability_slots where id = v_row.slot_id;
        if v_slot_start is not null and v_slot_start > now() then
          raise exception 'This consultation is scheduled for the future and cannot be archived yet.';
        end if;
      end if;
    end if;
    update public.consultations set doctor_archived_at = now() where id = p_consultation_id;
  else
    update public.consultations set doctor_archived_at = null where id = p_consultation_id;
  end if;
end;
$$;

revoke all on function public.doctor_archive_consultation(uuid, boolean) from public;
grant execute on function public.doctor_archive_consultation(uuid, boolean) to authenticated;
