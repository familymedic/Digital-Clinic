// Shared department/specialty list — used by the doctor registration
// form and the admin review screen so both always show the same set.
// Starting list proposed by Claude, confirmed workable by the physician
// as an editable starting point for the first five incoming doctors, not
// a fixed taxonomy — adding a new one later is just adding a string here,
// no migration needed, since `specialty` is a plain text column.
//
// Expanded 2026-09-27 (physician: "add dentist and other missing
// specialties as well") — the original 9 covered a narrow first-launch
// set; these 13 more round it out to the specialties a general online
// family-clinic directory would typically want to onboard doctors under.
// Still just a plain list, not a fixed taxonomy — trim or add to it any
// time with no migration needed.
export const SPECIALTIES = [
  "Family Medicine",
  "General Practice",
  "Pediatrics",
  "Gynecology",
  "Dermatology",
  "Internal Medicine",
  "ENT (Ear, Nose & Throat)",
  "Psychiatry",
  "Orthopedics",
  "Dentistry",
  "Cardiology",
  "Neurology",
  "Gastroenterology",
  "Pulmonology (Chest & Lungs)",
  "Endocrinology (Diabetes & Hormones)",
  "Nephrology (Kidney)",
  "Urology",
  "Ophthalmology (Eye)",
  "Rheumatology",
  "General Surgery",
  "Nutrition & Dietetics",
  "Physiotherapy",
] as const;
