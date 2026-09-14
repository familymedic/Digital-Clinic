// Platform fee-share tiers for a doctor-set consultation fee. Confirmed
// with the physician (2026-09-14) as part of the doctor-onboarding
// feature: PKR 150 up to 900, 200 for 901-1200, 250 for 1201-1500;
// anything above 1500 needs a separate, explicit admin approval and
// isn't auto-computed here at all.
//
// NOT wired into the live payment route yet — this is deliberately just
// the pure business-logic function, built now so the onboarding review
// screen can show a doctor's correct platform share at approval time,
// and so the payment-route change (a separate, careful step, since it
// touches real money — Section 38) can import this exact same function
// rather than re-deriving the tiers a second time.
export type PlatformFeeResult =
  | { requiresApproval: false; platformShare: number; doctorShare: number }
  | { requiresApproval: true };

export function computePlatformFeeShare(consultationFee: number): PlatformFeeResult {
  if (consultationFee > 1500) {
    return { requiresApproval: true };
  }
  let platformShare: number;
  if (consultationFee <= 900) {
    platformShare = 150;
  } else if (consultationFee <= 1200) {
    platformShare = 200;
  } else {
    platformShare = 250;
  }
  return { requiresApproval: false, platformShare, doctorShare: consultationFee - platformShare };
}

export const MIN_DOCTOR_CONSULTATION_FEE = 500;
