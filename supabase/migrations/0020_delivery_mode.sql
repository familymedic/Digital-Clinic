-- Phase 8, step 1: consultation delivery mode (Section 23/24/26/35 —
-- "video, audio, or text, patient's choice", scoped back in the Phase 1
-- revision but never actually built into the booking flow until now).
--
-- Scoped with the physician as a deliberately small first increment
-- (2026-09-12): just add the choice and store it. Text-mode bookings
-- work exactly as they do today — straight into the queue, no change.
-- Audio/video bookings are accepted and stored, but there is no
-- self-service scheduling yet; the doctor sees which mode was
-- requested and arranges the call outside the app for now. The actual
-- slot-booking system (self-service picking from published open time
-- slots, each with a doctor-set capacity so more than one patient can
-- share a slot before it's full) is captured as the next Phase 8 step,
-- not built in this migration.

alter table public.consultations
  add column if not exists delivery_mode text not null default 'text'
    check (delivery_mode in ('text', 'audio', 'video'));

comment on column public.consultations.delivery_mode is
  'How the patient chose to have this consultation delivered. ''text'' is handled entirely through the existing queue/portal flow. ''audio''/''video'' are accepted here but, until the Phase 8 slot-booking step exists, are not yet self-service scheduled — the doctor arranges the call directly.';

-- Patients already choose complaint at booking time under a column-level
-- INSERT grant restricted to (patient_id, complaint) (0015). This is the
-- same kind of patient-chosen, non-clinical field, so it's added to that
-- same grant — additive, doesn't touch the existing two columns.
grant insert (delivery_mode) on public.consultations to authenticated;
