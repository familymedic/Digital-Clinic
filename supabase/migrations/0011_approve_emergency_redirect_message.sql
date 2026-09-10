-- Phase 5: approve the emergency-redirect message for Shortness of
-- Breath / Chest Pain (physician: "approved", confirming the exact
-- English + Roman Urdu wording shown to him, unchanged from the draft
-- inserted as 0010).
--
-- Only a status flip -- no wording, schema, or clinical rule change.
-- Once this runs, /consultation/[id]/history shows this message
-- (instead of the "not ready yet" fallback) for the two zero-question
-- modules approved in 0010, in whichever language the patient picked.

update public.emergency_redirect_messages
set status = 'approved', approved_by = 'Zayn', approved_at = now()
where version = 1 and language in ('en', 'ur-roman') and status = 'draft';
