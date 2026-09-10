// Types for the Phase 5 AI-guided history engine. All clinical content
// (question text, answer labels, red-flag rules, consent wording) is
// data that lives in the Clinical Configuration Layer tables — never
// hard-coded here (blueprint Section 17).

export interface ClinicalModule {
  id: string;
  complaint: string;
  version: number;
  status: "draft" | "approved" | "retired";
  emergency_wording: string | null;
  referral_criteria: string | null;
  guideline_source: string | null;
}

export interface ClinicalAnswerOption {
  id: string;
  question_id: string;
  position: number;
  label: string;
  is_red_flag: boolean;
  red_flag_note: string | null;
}

export interface ClinicalQuestion {
  id: string;
  module_id: string;
  position: number;
  question_text: string;
  help_text: string | null;
  clinical_answer_options: ClinicalAnswerOption[];
}

export interface ConsentVersion {
  id: string;
  version: number;
  body: string;
  status: "draft" | "approved";
}

export interface ConsultationForHistory {
  id: string;
  complaint: string;
  history_status: "not_started" | "in_progress" | "completed";
  history_method: "ai_guided" | "voice_note" | null;
  is_flagged: boolean;
  patient: { full_name: string } | { full_name: string }[] | null;
}

export function patientNameFor(c: ConsultationForHistory): string {
  if (!c.patient) return "";
  return Array.isArray(c.patient) ? c.patient[0]?.full_name ?? "" : c.patient.full_name;
}
