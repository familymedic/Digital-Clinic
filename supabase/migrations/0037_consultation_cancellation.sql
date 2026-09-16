-- Fix #1 from the 2026-09-16 technical audit follow-up: there was no
-- way for a patient or doctor to cancel a paid, booked consultation —
-- not even a status to record it (consultations.status was locked to
-- 'pending_payment' / 'submitted' / 'completed' since 0024).
--
-- Per the physician's own explicit decision (2026-09-16, in response
-- to "can we fix everything without incurring any more cost"):
-- cancelling a consultation NEVER triggers an automatic refund. It
-- only ever changes the consultation's own status. A refund, if one is
-- warranted, stays exactly what it already is — a deliberate admin
-- decision made on the existing /admin/refunds screen, the same as
-- every refund today. This migration adds no new payment logic at
-- all — Section 38 change control treated "should a cancellation
-- refund automatically" as a real business decision needing an
-- explicit answer before writing any code, and the answer was no.

alter table public.consultations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.consultations
  drop constraint if exists consultations_status_check;
alter table public.consultations
  add constraint consultations_status_check
  check (status in ('pending_payment', 'submitted', 'completed', 'cancelled'));

-- cancel_consultation(): the ONLY way `status` can ever become
-- 'cancelled'. Security-definer, same pattern as assign_default_doctor
-- (0015) and mark_consultation_completed_on_issue (0018) — `status` is
-- deliberately not in `authenticated`'s column grant (0014), so a
-- direct client-side UPDATE of this column is refused at the database
-- level regardless of what the app's UI does. This function is the
-- one, narrow, fully-audited exception, and it enforces its own rules
-- rather than trusting the caller:
--
-- WHO can call it: the account holder who owns the family member this
-- consultation is for, OR the doctor it's assigned to. Checked inside
-- the function against auth.uid() — never a caller-supplied flag.
--
-- WHAT it allows: only a 'submitted' consultation (paid, not yet
-- completed) can be cancelled.
--   - 'pending_payment' — nothing to cancel; the patient simply
--     doesn't pay, same as today.
--   - 'completed' — already happened; raises a clear error rather
--     than silently doing nothing.
--   - already 'cancelled' — same, a clear error, not a silent no-op.
create or replace function public.cancel_consultation(
  p_consultation_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_is_account_holder boolean;
  v_is_doctor boolean;
begin
  select c.status,
         exists (
           select 1 from public.family_members fm
           where fm.id = c.patient_id and fm.account_id = auth.uid()
         ),
         coalesce(c.doctor_id = auth.uid(), false)
    into v_status, v_is_account_holder, v_is_doctor
  from public.consultations c
  where c.id = p_consultation_id;

  if v_status is null then
    raise exception 'Consultation not found.';
  end if;

  if not (v_is_account_holder or v_is_doctor) then
    raise exception 'You are not authorized to cancel this consultation.';
  end if;

  if v_status = 'cancelled' then
    raise exception 'This consultation has already been cancelled.';
  end if;
  if v_status = 'completed' then
    raise exception 'A completed consultation can no longer be cancelled.';
  end if;
  if v_status = 'pending_payment' then
    raise exception 'This consultation was never paid for — there is nothing to cancel.';
  end if;

  update public.consultations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = nullif(trim(p_reason), '')
  where id = p_consultation_id;
end;
$$;

grant execute on function public.cancel_consultation(uuid, text) to authenticated;
