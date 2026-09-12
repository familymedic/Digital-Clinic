-- Phase 7, step 2: the clinical workspace — a doctor clicks into a
-- consultation from the queue and sees the patient's full guided-history
-- answers and safety detail. Still read-only: no diagnosis, prescription,
-- or note-writing yet (Section 15) — that is the next increment.
--
-- Step 1 (0015) gave doctors read access to `consultations` and the
-- patient's `family_members` profile — enough for the queue. This step
-- extends the same access to the three tables the queue doesn't need
-- but the detail view does: the actual question/answer history, the
-- safety-event trail, and the consent record. Same scoping pattern as
-- every existing account-holder policy on these tables (0004): a
-- consultation the doctor is assigned to, not "everything."
--
-- No recursion risk here (Section 38 note, since 0015 hit exactly this
-- issue): none of these three tables are referenced by any other
-- table's policy, so scoping them by a subquery on `consultations` does
-- not create a new cycle. Confirmed by re-running the same non-superuser
-- RLS harness used for 0014/0015 — see delivery notes.

drop policy if exists "Doctors can view their patients' history responses" on public.consultation_history_responses;
create policy "Doctors can view their patients' history responses"
  on public.consultation_history_responses for select
  using (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
  );

drop policy if exists "Doctors can view their patients' safety events" on public.consultation_safety_events;
create policy "Doctors can view their patients' safety events"
  on public.consultation_safety_events for select
  using (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
  );

drop policy if exists "Doctors can view their patients' consents" on public.consultation_consents;
create policy "Doctors can view their patients' consents"
  on public.consultation_consents for select
  using (
    consultation_id in (select id from public.consultations where doctor_id = auth.uid())
  );
