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
