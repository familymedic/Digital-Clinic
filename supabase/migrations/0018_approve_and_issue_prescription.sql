-- Phase 7, step 4: "Approve & Issue" (Section 15's deliberate final
-- action) and the patient-facing prescription view (Section 16).
--
-- Step 3 (0017) built draft entry only. This step closes the loop:
-- once the doctor is satisfied with a draft, a separate, deliberate
-- action locks it and makes it visible to the patient for the first
-- time — matching Section 15's "Save draft → Physician review →
-- Approve & Issue" exactly, rather than a draft becoming visible by
-- some implicit condition.

-- 1. issued_at, so "who/what/when" (Section 15's audit requirement) is
--    fully answered by this one row: doctor_id (who), the fields as
--    they stood at issuance (what — see #2, locked after this), and
--    issued_at (when).
alter table public.consultation_assessments
  add column if not exists issued_at timestamptz;

-- 2. Lock a draft once issued. The existing update policy (0017) let a
--    doctor edit their own assessment regardless of its status; this
--    narrows it to only match rows that are STILL draft at the time of
--    the update. Once status flips to 'issued', no further UPDATE from
--    this policy can match that row at all (its pre-update status is
--    no longer 'draft') — including the very "Approve & Issue" action
--    that will not fire twice on an already-issued row. This is the
--    same silent-no-op RLS behavior used deliberately elsewhere
--    (Section 12/38): the app must check `status` itself and stop
--    offering edits once issued, rather than relying on an error.
drop policy if exists "Doctors can update their own draft assessments" on public.consultation_assessments;
create policy "Doctors can update their own draft assessments"
  on public.consultation_assessments for update
  using (
    status = 'draft'
    and consultation_id in (select id from public.consultations where doctor_id = auth.uid())
  )
  with check (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and doctor_id = auth.uid()
  );

-- 3. Same lock on the medication list — once the assessment for a
--    consultation is issued, its medication rows can no longer be
--    inserted, updated, or deleted by the doctor either.
drop policy if exists "Doctors can add medications for their consultations" on public.consultation_medications;
create policy "Doctors can add medications for their consultations"
  on public.consultation_medications for insert
  with check (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and not exists (
      select 1 from public.consultation_assessments a
      where a.consultation_id = consultation_medications.consultation_id and a.status = 'issued'
    )
  );

drop policy if exists "Doctors can update medications for their consultations" on public.consultation_medications;
create policy "Doctors can update medications for their consultations"
  on public.consultation_medications for update
  using (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and not exists (
      select 1 from public.consultation_assessments a
      where a.consultation_id = consultation_medications.consultation_id and a.status = 'issued'
    )
  )
  with check (consultation_id in (select id from public.consultations where doctor_id = auth.uid()));

drop policy if exists "Doctors can remove medications for their consultations" on public.consultation_medications;
create policy "Doctors can remove medications for their consultations"
  on public.consultation_medications for delete
  using (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
    and not exists (
      select 1 from public.consultation_assessments a
      where a.consultation_id = consultation_medications.consultation_id and a.status = 'issued'
    )
  );

-- 4. The patient can finally see it — but ONLY once issued. This is
--    enforced at the RLS layer itself, not just hidden in the app: a
--    draft is structurally invisible to the patient no matter what the
--    app's UI does, the same guarantee used throughout the Clinical
--    Configuration Layer for draft vs. approved content.
drop policy if exists "Account holders can view issued assessments for their family" on public.consultation_assessments;
create policy "Account holders can view issued assessments for their family"
  on public.consultation_assessments for select
  using (
    status = 'issued'
    and consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
  );

drop policy if exists "Account holders can view issued medications for their family" on public.consultation_medications;
create policy "Account holders can view issued medications for their family"
  on public.consultation_medications for select
  using (
    consultation_id in (
      select c.id from public.consultations c
      join public.family_members fm on fm.id = c.patient_id
      where fm.account_id = auth.uid()
    )
    and exists (
      select 1 from public.consultation_assessments a
      where a.consultation_id = consultation_medications.consultation_id and a.status = 'issued'
    )
  );

-- 5. When an assessment is issued, the consultation itself should
--    reflect that it's been actioned by the doctor — but the column-
--    level grant from 0014 deliberately does not let `authenticated`
--    (patient OR doctor — there's only one such role) write
--    `consultations.status` directly. A `security definer` trigger is
--    the correct way to make this one, specific, automatic transition
--    without reopening that column to direct writes — same pattern as
--    `assign_default_doctor` (0015).
create or replace function public.mark_consultation_completed_on_issue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    update public.consultations set status = 'completed' where id = new.consultation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_assessment_issued on public.consultation_assessments;
create trigger on_assessment_issued
  after update on public.consultation_assessments
  for each row execute function public.mark_consultation_completed_on_issue();
