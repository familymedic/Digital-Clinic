// Patient terms-of-service version tag (2026-10-03). Mirrors the
// doctor engagement agreement's own version-tracking convention
// (src/lib/engagementAgreement.ts, ENGAGEMENT_AGREEMENT_VERSION) —
// a plain string tag, not a database foreign key. Bump this whenever
// the Terms of Service or Privacy Policy pages change in a way that
// materially affects what a patient is agreeing to (for example, the
// refund-policy exclusions, or anything about what happens to their
// data). Changing the date or fixing a typo doesn't need a bump; a new
// section that changes what a patient is bound by does.
//
// This is stored alongside terms_accepted_at on patient_profiles
// (migration 0057) at the moment a patient ticks "I agree" — either at
// /register, or at guest quick-consult checkout — so that, if a refund
// or cancellation is ever disputed, there's a real record of which
// version of the policy that specific patient actually agreed to, not
// just that "the terms checkbox exists today."
export const PATIENT_TERMS_VERSION = "2026-10-03";
