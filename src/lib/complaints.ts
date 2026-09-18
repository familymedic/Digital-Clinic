// The fixed list of bookable complaints, shared between the normal
// booking flow (/book) and the free-follow-up redemption flow
// (/book/followup/[voucherId]). Kept in exactly one place because
// `consultations.complaint` is matched literally against
// `clinical_modules.complaint` when the guided-history flow looks up
// which module to run (see /consultation/[id]/history) — any drift
// between two separately-typed copies of this list would silently
// break history-taking for whichever complaint didn't match.
export const COMPLAINTS = [
  "Fever",
  "Cough",
  "Sore throat",
  "Abdominal pain",
  "Diarrhea / vomiting",
  "Headache",
  "Back pain",
  "Urinary symptoms",
  "Shortness of breath",
  "Chest pain",
  "Other",
];
