"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import {
  type AnswerOptionTranslation,
  type ClinicalAnswerOption,
  type ClinicalModule,
  type ClinicalQuestion,
  type ConsentVersion,
  type ConsultationForHistory,
  type EmergencyRedirectMessage,
  type Lang,
  type QuestionTranslation,
  optionLabel,
  optionRedFlagNote,
  patientNameFor,
  questionText,
} from "@/lib/clinicalHistory";
import { questionOfLabel, t } from "@/lib/i18n";

interface HistoryResponse {
  question_id: string;
  answer_option_id: string;
}

interface LoadedState {
  consultation: ConsultationForHistory;
  module: ClinicalModule | null;
  consentVersion: ConsentVersion | null;
  hasConsented: boolean;
  questions: ClinicalQuestion[];
  responses: HistoryResponse[];
  questionTranslations: QuestionTranslation[];
  answerOptionTranslations: AnswerOptionTranslation[];
  // Only relevant for a zero-question module (Section 8 design
  // decision: Shortness of Breath / Chest Pain skip the questionnaire
  // entirely). null when not applicable, or when applicable but the
  // message itself isn't approved yet.
  redirectMessage: EmergencyRedirectMessage | null;
}

export default function ConsultationHistory() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const { session, loading: authLoading } = useAuth();

  const [state, setState] = useState<LoadedState | "not-found" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingFlagNote, setPendingFlagNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);

    const { data: consultation, error: cErr } = await supabase
      .from("consultations")
      .select(
        "id, complaint, history_status, history_method, is_flagged, patient_language, patient:family_members(full_name)"
      )
      .eq("id", consultationId)
      .maybeSingle();

    if (cErr) {
      setLoadError(cErr.message);
      return;
    }
    if (!consultation) {
      setState("not-found");
      return;
    }

    const lang = (consultation as ConsultationForHistory).patient_language;

    const { data: moduleRow } = await supabase
      .from("clinical_modules")
      .select("*")
      .eq("complaint", consultation.complaint)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let consentVersion = null;
    if (lang) {
      const { data: cv } = await supabase
        .from("consent_versions")
        .select("*")
        .eq("language", lang)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      consentVersion = cv;
      if (!consentVersion && lang !== "en") {
        const { data: cvEn } = await supabase
          .from("consent_versions")
          .select("*")
          .eq("language", "en")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        consentVersion = cvEn;
      }
    }

    const { data: existingConsent } = await supabase
      .from("consultation_consents")
      .select("id")
      .eq("consultation_id", consultationId)
      .maybeSingle();

    let questions: ClinicalQuestion[] = [];
    let responses: HistoryResponse[] = [];
    let questionTranslations: QuestionTranslation[] = [];
    let answerOptionTranslations: AnswerOptionTranslation[] = [];
    let redirectMessage: EmergencyRedirectMessage | null = null;

    if (moduleRow) {
      const { data: questionRows } = await supabase
        .from("clinical_questions")
        .select("*, clinical_answer_options(*)")
        .eq("module_id", moduleRow.id)
        .order("position", { ascending: true });

      questions = (questionRows ?? []).map((q) => ({
        ...q,
        clinical_answer_options: [...(q.clinical_answer_options ?? [])].sort(
          (a: ClinicalAnswerOption, b: ClinicalAnswerOption) => a.position - b.position
        ),
      })) as ClinicalQuestion[];

      const { data: responseRows } = await supabase
        .from("consultation_history_responses")
        .select("question_id, answer_option_id")
        .eq("consultation_id", consultationId);

      responses = (responseRows ?? []) as HistoryResponse[];

      if (lang && lang !== "en" && questions.length > 0) {
        const questionIds = questions.map((q) => q.id);
        const optionIds = questions.flatMap((q) =>
          q.clinical_answer_options.map((o) => o.id)
        );

        const { data: qt } = await supabase
          .from("question_translations")
          .select("question_id, language, wording_text")
          .eq("language", lang)
          .in("question_id", questionIds);
        questionTranslations = (qt ?? []) as QuestionTranslation[];

        const { data: aot } = await supabase
          .from("answer_option_translations")
          .select("answer_option_id, language, label_text, red_flag_note_text")
          .eq("language", lang)
          .in("answer_option_id", optionIds);
        answerOptionTranslations = (aot ?? []) as AnswerOptionTranslation[];
      }

      // Zero-question module — Section 8 design decision (Shortness of
      // Breath / Chest Pain skip the questionnaire entirely). Look up
      // the shared, approved emergency-redirect message for the
      // patient's language, falling back to English, same pattern as
      // consent.
      if (questions.length === 0 && lang) {
        const { data: rm } = await supabase
          .from("emergency_redirect_messages")
          .select("*")
          .eq("language", lang)
          .eq("status", "approved")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        redirectMessage = rm as EmergencyRedirectMessage | null;
        if (!redirectMessage && lang !== "en") {
          const { data: rmEn } = await supabase
            .from("emergency_redirect_messages")
            .select("*")
            .eq("language", "en")
            .eq("status", "approved")
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();
          redirectMessage = rmEn as EmergencyRedirectMessage | null;
        }
      }
    }

    setState({
      consultation: consultation as ConsultationForHistory,
      module: moduleRow as ClinicalModule | null,
      consentVersion: consentVersion as ConsentVersion | null,
      hasConsented: !!existingConsent,
      questions,
      responses,
      questionTranslations,
      answerOptionTranslations,
      redirectMessage,
    });
  }, [consultationId, session]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  async function chooseLanguage(lang: Lang) {
    if (!supabase) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase
      .from("consultations")
      .update({ patient_language: lang })
      .eq("id", consultationId);
    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    load();
  }

  async function acceptConsent() {
    if (!supabase || state === null || state === "not-found" || !state.consentVersion) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.from("consultation_consents").insert({
      consultation_id: consultationId,
      consent_version_id: state.consentVersion.id,
    });
    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    load();
  }

  async function chooseMethod(method: "ai_guided" | "voice_note") {
    if (!supabase || state === null || state === "not-found") return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase
      .from("consultations")
      .update({
        history_method: method,
        history_status: "in_progress",
        module_id: state.module?.id ?? null,
      })
      .eq("id", consultationId);
    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    load();
  }

  async function answerQuestion(question: ClinicalQuestion, option: ClinicalAnswerOption) {
    if (!supabase || state === null || state === "not-found") return;
    setBusy(true);
    setActionError(null);

    const lang: Lang = state.consultation.patient_language ?? "en";

    const { data: inserted, error } = await supabase
      .from("consultation_history_responses")
      .insert({
        consultation_id: consultationId,
        question_id: question.id,
        answer_option_id: option.id,
        language: lang,
      })
      .select()
      .single();

    if (error) {
      setBusy(false);
      setActionError(error.message);
      return;
    }

    const isLastQuestion = state.responses.length + 1 >= state.questions.length;
    if (isLastQuestion) {
      await supabase
        .from("consultations")
        .update({ history_status: "completed" })
        .eq("id", consultationId);
    }

    if (option.is_red_flag) {
      const noteForRecord = option.red_flag_note ?? `${question.question_text} -> ${option.label}`;
      await supabase.from("consultation_safety_events").insert({
        consultation_id: consultationId,
        triggered_by_response_id: inserted.id,
        rule_description: noteForRecord,
        system_action:
          "Patient shown urgent-care guidance; consultation flagged for priority review.",
      });
      await supabase
        .from("consultations")
        .update({ is_flagged: true })
        .eq("id", consultationId);
      setBusy(false);
      const displayedNote =
        optionRedFlagNote(option, lang, state.answerOptionTranslations) ??
        t("genericFlagFallback", lang);
      setPendingFlagNote(displayedNote);
      return;
    }

    setBusy(false);
    load();
  }

  function continueAfterFlag() {
    setPendingFlagNote(null);
    load();
  }

  // Zero-question module (Shortness of Breath / Chest Pain): there's no
  // questionnaire to answer, so acknowledging the emergency message is
  // the entire "history" step. Always flags for priority review,
  // regardless of anything else — the complaint category alone is the
  // trigger, per the physician's decision.
  async function acknowledgeEmergencyRedirect() {
    if (!supabase || state === null || state === "not-found") return;
    setBusy(true);
    setActionError(null);

    await supabase.from("consultation_safety_events").insert({
      consultation_id: consultationId,
      triggered_by_response_id: null,
      rule_description: `Immediate-emergency complaint category selected (${state.consultation.complaint}).`,
      system_action:
        "Patient shown urgent-care guidance; consultation flagged for priority review; no guided questionnaire for this complaint.",
    });

    const { error } = await supabase
      .from("consultations")
      .update({ is_flagged: true, history_status: "completed" })
      .eq("id", consultationId);

    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    load();
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so this page can&rsquo;t
            load anything.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>You need to log in to see this.</p>
            <Link
              href="/login"
              className="mt-3 inline-block font-medium text-teal-700 underline underline-offset-2"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load this consultation: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (state === null) {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Loading…
        </div>
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div>
        <PageHeader title="Consultation history" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>
              We couldn&rsquo;t find that consultation, or it isn&rsquo;t part
              of your family account.
            </p>
            <Link
              href="/dashboard"
              className="mt-3 inline-block font-medium text-teal-700 underline underline-offset-2"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const patientName = patientNameFor(state.consultation);

  // Language choice — the very first step, before consent or content,
  // so everything after it can render in the patient's chosen language.
  if (!state.consultation.patient_language) {
    return (
      <div>
        <PageHeader title="Choose your language" subtitle="Apni zaban chunain" />
        <div className="mx-auto max-w-md space-y-3 px-4 py-10 sm:px-6">
          {actionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {actionError}
            </div>
          )}
          <button
            onClick={() => chooseLanguage("en")}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-600 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-slate-900">English</p>
            <p className="mt-1 text-sm text-slate-500">
              Ask your history in everyday English.
            </p>
          </button>
          <button
            onClick={() => chooseLanguage("ur-roman")}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-600 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-slate-900">Roman Urdu</p>
            <p className="mt-1 text-sm text-slate-500">
              Apni takleef Roman Urdu mein bataen.
            </p>
          </button>
        </div>
      </div>
    );
  }

  const lang: Lang = state.consultation.patient_language;

  // No approved module for this complaint yet — honest, not fake content.
  if (!state.module) {
    return (
      <div>
        <PageHeader
          title={`${state.consultation.complaint} — ${t("history", lang)}`}
          subtitle={`${t("forLabel", lang)} ${patientName}`}
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Guided history questions for &ldquo;{state.consultation.complaint}
            &rdquo; aren&rsquo;t ready yet — your doctor hasn&rsquo;t approved
            that module for use. Your booking is still recorded; your doctor
            will follow up with you directly.
          </div>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            {t("backToDashboard", lang)}
          </Link>
        </div>
      </div>
    );
  }

  // Zero-question module — Section 8 design decision: Shortness of
  // Breath / Chest Pain skip the questionnaire entirely and show an
  // immediate emergency message instead. Handled as its own branch,
  // before consent and before the generic completed-summary view,
  // since there's no consent to give and no answers to list.
  if (state.module && state.questions.length === 0) {
    if (state.consultation.history_status === "completed") {
      return (
        <div>
          <PageHeader
            title={`${state.consultation.complaint} — ${t("allSet", lang)}`}
            subtitle={`${t("forLabel", lang)} ${patientName}`}
          />
          <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
              {t("doctorNotifiedPriority", lang)}
            </div>
            <Link
              href="/dashboard"
              className="mt-6 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              {t("backToDashboard", lang)}
            </Link>
          </div>
        </div>
      );
    }

    if (!state.redirectMessage) {
      return (
        <div>
          <PageHeader
            title={`${state.consultation.complaint} — ${t("history", lang)}`}
            subtitle={`${t("forLabel", lang)} ${patientName}`}
          />
          <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {t("emergencyContentNotReady", lang)}
            </div>
            <Link
              href="/dashboard"
              className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              {t("backToDashboard", lang)}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div>
        <PageHeader title={t("urgentCareHeading", lang)} subtitle={`${t("forLabel", lang)} ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {actionError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {actionError}
            </div>
          )}
          <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm leading-relaxed text-red-900">
            {state.redirectMessage.body}
          </div>
          <button
            onClick={acknowledgeEmergencyRedirect}
            disabled={busy}
            className="mt-5 w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t("saving", lang) : t("continue", lang)}
          </button>
        </div>
      </div>
    );
  }

  // History already completed — read-only summary.
  if (state.consultation.history_status === "completed") {
    return (
      <div>
        <PageHeader
          title={`${state.consultation.complaint} — ${t("historySubmitted", lang)}`}
          subtitle={`${t("forLabel", lang)} ${patientName}`}
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {state.consultation.is_flagged && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {t("flaggedNotice", lang)}
            </div>
          )}
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            {t("thanksRecorded", lang)}
          </div>
          <ul className="mt-6 space-y-3">
            {state.questions.map((q) => {
              const response = state.responses.find((r) => r.question_id === q.id);
              const option = q.clinical_answer_options.find(
                (o) => o.id === response?.answer_option_id
              );
              return (
                <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-900">
                    {questionText(q, lang, state.questionTranslations)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {option ? optionLabel(option, lang, state.answerOptionTranslations) : "—"}
                  </p>
                </li>
              );
            })}
          </ul>
          <Link
            href="/dashboard"
            className="mt-6 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            {t("backToDashboard", lang)}
          </Link>
        </div>
      </div>
    );
  }

  // Consent gate — a discrete record, separate from the site-wide Terms.
  if (!state.hasConsented) {
    if (!state.consentVersion) {
      return (
        <div>
          <PageHeader
            title={`${state.consultation.complaint} — ${t("history", lang)}`}
            subtitle={`${t("forLabel", lang)} ${patientName}`}
          />
          <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              The consent wording for guided history-taking hasn&rsquo;t
              been approved yet, so this can&rsquo;t start. Your doctor will
              follow up with you directly.
            </div>
            <Link
              href="/dashboard"
              className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              {t("backToDashboard", lang)}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div>
        <PageHeader title={t("beforeWeStart", lang)} subtitle={`${t("forLabel", lang)} ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {actionError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {actionError}
            </div>
          )}
          <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700">
            {state.consentVersion.body}
          </div>
          <button
            onClick={acceptConsent}
            disabled={busy}
            className="mt-5 w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t("saving", lang) : t("iUnderstandAndAgree", lang)}
          </button>
        </div>
      </div>
    );
  }

  // Method choice — Option A and Option B shown with equal prominence.
  if (!state.consultation.history_method) {
    return (
      <div>
        <PageHeader
          title={t("howShareHistory", lang)}
          subtitle={`${t("forLabel", lang)} ${patientName} — ${t("bothOptionsEqual", lang)}`}
        />
        <div className="mx-auto max-w-md space-y-4 px-4 py-10 sm:px-6">
          {actionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {actionError}
            </div>
          )}
          <button
            onClick={() => chooseMethod("ai_guided")}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-600 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-slate-900">{t("answerFewQuestions", lang)}</p>
            <p className="mt-1 text-sm text-slate-500">{t("answerFewQuestionsDesc", lang)}</p>
          </button>
          <button
            onClick={() => chooseMethod("voice_note")}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-600 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-slate-900">{t("recordVoiceNote", lang)}</p>
            <p className="mt-1 text-sm text-slate-500">{t("recordVoiceNoteDesc", lang)}</p>
          </button>
        </div>
      </div>
    );
  }

  // Voice note — honest placeholder, not built yet.
  if (state.consultation.history_method === "voice_note") {
    return (
      <div>
        <PageHeader title={t("voiceNoteTitle", lang)} subtitle={`${t("forLabel", lang)} ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {t("voiceNoteNotBuilt", lang)}
          </div>
          <button
            onClick={() => chooseMethod("ai_guided")}
            disabled={busy}
            className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? t("switching", lang) : t("useGuidedInstead", lang)}
          </button>
        </div>
      </div>
    );
  }

  // Flagged interstitial — pauses the flow rather than sliding past it.
  if (pendingFlagNote) {
    return (
      <div>
        <PageHeader title={t("pleaseReadThis", lang)} subtitle={`${t("forLabel", lang)} ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm text-red-900">
            <p className="font-semibold">{pendingFlagNote}</p>
            <p className="mt-2 leading-relaxed">{t("emergencyFollowup", lang)}</p>
          </div>
          <button
            onClick={continueAfterFlag}
            className="mt-5 rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            {t("continue", lang)}
          </button>
        </div>
      </div>
    );
  }

  // Guided questions.
  const answeredIds = new Set(state.responses.map((r) => r.question_id));
  const currentQuestion = state.questions.find((q) => !answeredIds.has(q.id));

  if (!currentQuestion) {
    // All answered but a status update hasn't landed yet — reload.
    load();
    return (
      <div>
        <PageHeader title={`${state.consultation.complaint} — ${t("history", lang)}`} />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Saving…
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${state.consultation.complaint} — ${t("history", lang)}`}
        subtitle={`${t("forLabel", lang)} ${patientName} — ${questionOfLabel(lang, answeredIds.size + 1, state.questions.length)}`}
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {actionError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {actionError}
          </div>
        )}
        <p className="text-base font-semibold text-slate-900">
          {questionText(currentQuestion, lang, state.questionTranslations)}
        </p>
        {currentQuestion.help_text && (
          <p className="mt-1 text-sm text-slate-500">{currentQuestion.help_text}</p>
        )}
        <div className="mt-5 space-y-2">
          {currentQuestion.clinical_answer_options.map((option) => (
            <button
              key={option.id}
              onClick={() => answerQuestion(currentQuestion, option)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              {optionLabel(option, lang, state.answerOptionTranslations)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
