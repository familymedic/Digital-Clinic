// Shared department/specialty list — used by the doctor registration
// form and the admin review screen so both always show the same set.
// Starting list proposed by Claude, confirmed workable by the physician
// as an editable starting point for the first five incoming doctors, not
// a fixed taxonomy — adding a new one later is just adding a string here,
// no migration needed, since `specialty` is a plain text column.
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
] as const;
