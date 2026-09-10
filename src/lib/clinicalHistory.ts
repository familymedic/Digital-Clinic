// Types for the Phase 5 AI-guided history engine. All clinical content
// (question text, answer labels, red-flag rules, consent wording) is
// data that lives in the Clinical Configuration Layer tables — never
// hard-coded here (blueprint Section 17).
//
// Language is a presentation layer on top of this: question_translations
// and answer_option_translations hold approved non-English wording for
// the same question/option row. English itself is never a "translation"
// row — clinical_questions.question_text and clinical_answer_options.label
// stay the one canonical source, so the underlying clinical content is
// unchanged by any of this.

export type Lang = "en" | "ur-roman";

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
  language: Lang;
  body: string;
  status: "draft" | "approved";
}

// A module with zero clinical_questions rows is an "immediate redirect"
// complaint (Section 8 design decision: for Shortness of Breath and
// Chest Pain, skip the guided questionnaire entirely and show this
// shared, physician-approved message instead). Not module-specific —
// the physician chose one shared message for both complaints, so this
// carries no module_id.
export interface EmergencyRedirectMessage {
  id: string;
  version: number;
  language: Lang;
  body: string;
  status: "draft" | "approved";
}

export interface QuestionTranslation {
  question_id: string;
  language: Lang;
  wording_text: string;
}

export interface AnswerOptionTranslation {
  answer_option_id: string;
  language: Lang;
  label_text: string;
  red_flag_note_text: string | null;
}

export interface ConsultationForHistory {
  id: string;
  complaint: string;
  history_status: "not_started" | "in_progress" | "completed";
  history_method: "ai_guided" | "voice_note" | null;
  is_flagged: boolean;
  patient_language: Lang | null;
  patient: { full_name: string } | { full_name: string }[] | null;
}

export function patientNameFor(c: ConsultationForHistory): string {
  if (!c.patient) return "";
  return Array.isArray(c.patient) ? c.patient[0]?.full_name ?? "" : c.patient.full_name;
}

// Displayed question/option text, resolved for the chosen language with
// an automatic fallback to English whenever no approved translation
// exists yet for that specific question or option — never a blank or a
// half-translated screen.
export function questionText(
  q: ClinicalQuestion,
  lang: Lang,
  translations: QuestionTranslation[]
): string {
  if (lang === "en") return q.question_text;
  const t = translations.find((tr) => tr.question_id === q.id && tr.language === lang);
  return t?.wording_text ?? q.question_text;
}

export function optionLabel(
  o: ClinicalAnswerOption,
  lang: Lang,
  translations: AnswerOptionTranslation[]
): string {
  if (lang === "en") return o.label;
  const t = translations.find((tr) => tr.answer_option_id === o.id && tr.language === lang);
  return t?.label_text ?? o.label;
}

export function optionRedFlagNote(
  o: ClinicalAnswerOption,
  lang: Lang,
  translations: AnswerOptionTranslation[]
): string | null {
  if (lang === "en") return o.red_flag_note;
  const t = translations.find((tr) => tr.answer_option_id === o.id && tr.language === lang);
  return t?.red_flag_note_text ?? o.red_flag_note;
}
