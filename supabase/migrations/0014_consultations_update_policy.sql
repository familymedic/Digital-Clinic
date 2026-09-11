-- Bug fix, Phase 6: `consultations` never had an UPDATE policy.
--
-- Diagnosed from a live test: the physician reported the guided-history
-- flow got stuck right after choosing a language -- no error shown,
-- but nothing progressed, and the browser console showed no
-- application error either. Root cause: 0002 (superseded) and 0003
-- only ever created SELECT and INSERT policies on `consultations` --
-- an UPDATE policy was never added, in any phase since. Every place
-- the app updates a consultation directly from the patient side
-- (recording patient_language, history_method/history_status,
-- module_id, is_flagged) has therefore been silently blocked by
-- Postgres RLS since Phase 4b: with RLS enabled and no matching
-- UPDATE policy, an UPDATE simply matches zero rows and returns no
-- error at all -- exactly the silent "nothing happens" symptom
-- observed. It would have blocked language choice, the history-method
-- choice, marking history complete, and setting is_flagged on a red
-- flag -- the entire guided-history flow past consent, for every
-- complaint, for every patient, since Phase 4b.
--
-- Why this was never caught in Claude's own testing: every local
-- verification in this project has run migrations and test queries as
-- the Postgres superuser, which BYPASSES ROW LEVEL SECURITY entirely
-- by design -- a missing *policy* is invisible to that kind of test,
-- since the superuser was never subject to it in the first place. It
-- only surfaces under a real authenticated, non-superuser session --
-- which is exactly what today's live test against the physician's
-- actual Supabase project was the first time this flow had ever been
-- exercised end-to-end. This migration's own verification (see the
-- delivery notes) was redone properly this time: as a non-superuser
-- role with RLS actually enforced, not as postgres.
--
-- Fix, two layers:
-- 1. The missing UPDATE policy, scoped identically to the existing
--    SELECT/INSERT policies on this table (the account holder can act
--    on their own family's consultations, and only those).
-- 2. Defense in depth: a column-level GRANT restricting *which*
--    columns are updatable at all, independent of RLS. Even with the
--    row-level policy above, nothing stops a technically-inclined
--    patient from calling the API directly and attempting to update a
--    column the app's own UI never touches (doctor_id, status, or any
--    future physician-authored field). Postgres column-level
--    privileges close that off at the grant level: only the specific
--    columns the patient-facing flow actually needs to set are made
--    updatable for the authenticated role.

drop policy if exists "Account holders can update their family's consultations" on public.consultations;
create policy "Account holders can update their family's consultations"
  on public.consultations for update
  using (
    patient_id in (
      select id from public.family_members where account_id = auth.uid()
    )
  )
  with check (
    patient_id in (
      select id from public.family_members where account_id = auth.uid()
    )
  );

revoke update on public.consultations from authenticated;
grant update (patient_language, history_method, history_status, module_id, is_flagged)
  on public.consultations to authenticated;
