// Single source of truth for the public site's identity (SEO batch, 2026-10-07).
// Used by the root layout, sitemap, robots and the doctor-profile metadata.
//
// Positioning (physician's correction, 2026-10-07): Family Medic is about
// CONTINUITY OF CARE FOR FAMILIES — a doctor who knows your family, one
// account for everyone, follow-up care — NOT a service aimed at Pakistanis
// living abroad. Keep all search copy in that voice, and only state things
// the app really does (PMDC-verified doctors, family accounts, video/audio/
// text consultations, prescriptions, follow-up, health records).
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://thefamilymedic.com"
).replace(/\/+$/, "");

export const SITE_NAME = "Family Medic";

export const SITE_TITLE = "Family Medic — A Family Doctor Who Knows Your Family";

export const SITE_DESCRIPTION =
  "Online family medicine with continuity of care: one account for the whole family, PMDC-verified doctors you can return to, by video, audio or text.";

export const CONTACT_EMAIL = "contact@thefamilymedic.com";
