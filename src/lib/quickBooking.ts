// Quick booking (people who are not logged in book in one pass, then get a
// saved link or "mobile number + PIN" to come back to their appointment).
//
// OFF by default. Nothing a patient sees changes until NEXT_PUBLIC_QUICK_BOOKING
// is set to "true" in Vercel and the site is redeployed. Setting it back to
// anything else (or removing it) and redeploying returns the booking page to
// exactly what it was.
export const QUICK_BOOKING_ENABLED = process.env.NEXT_PUBLIC_QUICK_BOOKING === "true";

// How long a guest can get back to their appointment AFTER their last
// appointment ends (calls count as ending an hour after they start; text
// consultations stay open for a day after booking - see 0077). Records are
// kept regardless; this only limits the patient's own link / PIN lookup.
export const GUEST_ACCESS_DAYS = 3;

export const GUEST_PIN_MIN_LENGTH = 4;
export const GUEST_PIN_MAX_LENGTH = 6;

// Accounts created by quick booking have no real email address. This is the
// shape of the placeholder we give them, so other code can recognise it and
// never try to email it.
export function isPlaceholderGuestEmail(email: string | null | undefined): boolean {
  return !!email && /^guest\.[0-9a-f]{24}@/i.test(email);
}
