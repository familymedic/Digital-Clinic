// Credentials a doctor can ask to have shown next to their name
// (2026-10-08). A doctor REQUESTS one; an admin approves it; only
// approved ones are public. This list is the single place that decides
// which credentials exist and which need proof — to add or change one,
// edit a line here (no database change needed).
//
//  * needsEvidence = false: MBBS / BDS / RMP — checked by the admin
//    against the PMDC certificate the doctor already submitted.
//  * needsEvidence = true: postgraduate qualifications (MCPS, FCPS, ...).
//    The doctor must upload the certificate awarded by CPSP, or a PMDC
//    registration showing the updated postgraduate qualification.

export interface CredentialOption {
  code: string;
  label: string;
  needsEvidence: boolean;
  /** Short note shown under the choice. */
  hint: string;
}

const PMDC_NOTE = "Checked against the PMDC certificate you already submitted — nothing more to upload.";
const POSTGRAD_NOTE =
  "Upload your certificate awarded by CPSP (or the awarding body), or your PMDC registration showing the updated postgraduate qualification.";

export const CREDENTIALS: CredentialOption[] = [
  { code: "MBBS", label: "MBBS", needsEvidence: false, hint: PMDC_NOTE },
  { code: "BDS", label: "BDS (dental degree)", needsEvidence: false, hint: PMDC_NOTE },
  { code: "RMP", label: "RMP (Registered Medical Practitioner)", needsEvidence: false, hint: PMDC_NOTE },
  { code: "MCPS", label: "MCPS", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "FCPS", label: "FCPS", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "MD", label: "MD", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "MS", label: "MS", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "MDS", label: "MDS (dental postgraduate)", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "MRCP", label: "MRCP", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "FRCP", label: "FRCP", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "MRCGP", label: "MRCGP", needsEvidence: true, hint: POSTGRAD_NOTE },
  { code: "FRCS", label: "FRCS", needsEvidence: true, hint: POSTGRAD_NOTE },
];

export function credentialOption(code: string): CredentialOption | undefined {
  return CREDENTIALS.find((c) => c.code === code);
}

export type CredentialStatus = "pending_review" | "approved" | "rejected" | "removed";

export interface DoctorCredentialRow {
  id: string;
  doctor_id: string;
  credential: string;
  detail: string | null;
  status: CredentialStatus;
  evidence_path: string | null;
  rejection_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
}

export const STATUS_LABEL: Record<CredentialStatus, { text: string; tone: string }> = {
  pending_review: { text: "Waiting for review", tone: "bg-amber-100 text-amber-800" },
  approved: { text: "Approved — shown to patients", tone: "bg-teal-100 text-teal-800" },
  rejected: { text: "Not approved", tone: "bg-red-100 text-red-800" },
  removed: { text: "Removed", tone: "bg-slate-100 text-slate-600" },
};

// "Other" credentials (2026-10-11). A doctor can ask for a qualification that
// is not in the list above (for example CHPE — Certificate in Health
// Professions Education). It is stored in the same table as any other
// credential, but ALWAYS needs proof, and is public only once an admin has
// approved it — exactly like a postgraduate qualification. The doctor types
// the short name (2–20 characters, which is the database's own limit) and,
// optionally, who awarded it (up to 40 characters, stored as the "subject").

export const OTHER_NAME_MAX = 20;
export const DETAIL_MAX = 40;

const OTHER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 .&+/()-]*$/;

/** True for a credential that is not one of the listed codes. */
export function isCustomCredential(code: string): boolean {
  return !credentialOption(code);
}

/**
 * Clean and check a typed "Other" credential name.
 * Returns the cleaned name, or an error message to show the doctor.
 */
export function checkOtherName(raw: string): { name: string; error: null } | { name: null; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { name: null, error: "Please type the short name of your qualification (for example CHPE)." };
  if (name.length > OTHER_NAME_MAX) {
    return { name: null, error: `Please keep the name to ${OTHER_NAME_MAX} characters or fewer — use the short form (for example CHPE).` };
  }
  if (!OTHER_NAME_PATTERN.test(name)) {
    return { name: null, error: "Please use letters and numbers only (spaces, brackets, - . & + / are fine)." };
  }
  return { name, error: null };
}

/** A typed name that matches a listed code (any capitalisation) becomes that listed code. */
export function matchListedCode(name: string): string | null {
  const hit = CREDENTIALS.find((c) => c.code.toLowerCase() === name.toLowerCase());
  return hit ? hit.code : null;
}
