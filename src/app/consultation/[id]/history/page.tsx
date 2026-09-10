"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import {
  type ClinicalAnswerOption,
  type ClinicalModule,
  type ClinicalQuestion,
  type ConsentVersion,
  type ConsultationForHistory,
  patientNameFor,
} from "@/lib/clinicalHistory";

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
        "id, complaint, history_status, history_method, is_flagged, patient:family_members(full_name)"
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

    const { data: moduleRow } = await supabase
      .from("clinical_modules")
      .select("*")
      .eq("complaint", consultation.complaint)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: consentVersion } = await supabase
      .from("consent_versions")
      .select("*")
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: existingConsent } = await supabase
      .from("consultation_consents")
      .select("id")
      .eq("consultation_id", consultationId)
      .maybeSingle();

    let questions: ClinicalQuestion[] = [];
    let responses: HistoryResponse[] = [];

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
    }

    setState({
      consultation: consultation as ConsultationForHistory,
      module: moduleRow as ClinicalModule | null,
      consentVersion: consentVersion as ConsentVersion | null,
      hasConsented: !!existingConsent,
      questions,
      responses,
    });
  }, [consultationId, session]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

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

    const { data: inserted, error } = await supabase
      .from("consultation_history_responses")
      .insert({
        consultation_id: consultationId,
        question_id: question.id,
        answer_option_id: option.id,
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
      await supabase.from("consultation_safety_events").insert({
        consultation_id: consultationId,
        triggered_by_response_id: inserted.id,
        rule_description: option.red_flag_note ?? `${question.question_text} -> ${option.label}`,
        system_action:
          "Patient shown urgent-care guidance; consultation flagged for priority review.",
      });
      await supabase
        .from("consultations")
        .update({ is_flagged: true })
        .eq("id", consultationId);
      setBusy(false);
      setPendingFlagNote(
        option.red_flag_note ?? "Your answer suggests this needs prompt attention."
      );
      return;
    }

    setBusy(false);
    load();
  }

  function continueAfterFlag() {
    setPendingFlagNote(null);
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

  // No approved module for this complaint yet — honest, not fake content.
  if (!state.module) {
    return (
      <div>
        <PageHeader
          title={`${state.consultation.complaint} — history`}
          subtitle={`For ${patientName}`}
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
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // History already completed — read-only summary.
  if (state.consultation.history_status === "completed") {
    return (
      <div>
        <PageHeader
          title={`${state.consultation.complaint} — history submitted`}
          subtitle={`For ${patientName}`}
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {state.consultation.is_flagged && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              One or more answers were flagged for your doctor&rsquo;s prompt
              attention.
            </div>
          )}
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            Thanks — this history has been recorded and is attached to the
            consultation for your doctor to review.
          </div>
          <ul className="mt-6 space-y-3">
            {state.questions.map((q) => {
              const response = state.responses.find((r) => r.question_id === q.id);
              const option = q.clinical_answer_options.find(
                (o) => o.id === response?.answer_option_id
              );
              return (
                <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-900">{q.question_text}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {option ? option.label : "—"}
                  </p>
                </li>
              );
            })}
          </ul>
          <Link
            href="/dashboard"
            className="mt-6 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            Back to dashboard
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
          <PageHeader title={`${state.consultation.complaint} — history`} subtitle={`For ${patientName}`} />
          <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              The consent wording for AI-assisted history-taking hasn&rsquo;t
              been approved yet, so this can&rsquo;t start. Your doctor will
              follow up with you directly.
            </div>
            <Link
              href="/dashboard"
              className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div>
        <PageHeader title="Before we start" subtitle={`For ${patientName}`} />
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
            {busy ? "Saving…" : "I understand and agree"}
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
          title="How would you like to share your history?"
          subtitle={`For ${patientName} — both options work equally well; pick whichever is easier.`}
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
            <p className="text-sm font-semibold text-slate-900">Answer a few questions</p>
            <p className="mt-1 text-sm text-slate-500">
              A short set of multiple-choice questions about your complaint.
            </p>
          </button>
          <button
            onClick={() => chooseMethod("voice_note")}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-600 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-slate-900">Record a voice note instead</p>
            <p className="mt-1 text-sm text-slate-500">
              Describe what&rsquo;s going on in your own words.
            </p>
          </button>
        </div>
      </div>
    );
  }

  // Voice note — honest placeholder, not built yet.
  if (state.consultation.history_method === "voice_note") {
    return (
      <div>
        <PageHeader title="Voice note" subtitle={`For ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Voice-note recording isn&rsquo;t built yet in this phase. You can
            use the guided questions instead for now, or your doctor will
            follow up with you directly.
          </div>
          <button
            onClick={() => chooseMethod("ai_guided")}
            disabled={busy}
            className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? "Switching…" : "Use guided questions instead"}
          </button>
        </div>
      </div>
    );
  }

  // Flagged interstitial — pauses the flow rather than sliding past it.
  if (pendingFlagNote) {
    return (
      <div>
        <PageHeader title="Please read this" subtitle={`For ${patientName}`} />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm text-red-900">
            <p className="font-semibold">{pendingFlagNote}</p>
            <p className="mt-2 leading-relaxed">
              If you think this is a medical emergency, do not wait — seek
              immediate emergency care or contact your local emergency
              service now. Your doctor has also been notified to review this
              consultation as a priority.
            </p>
          </div>
          <button
            onClick={continueAfterFlag}
            className="mt-5 rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Continue
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
        <PageHeader title={`${state.consultation.complaint} — history`} />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Saving…
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${state.consultation.complaint} — history`}
        subtitle={`For ${patientName} — question ${answeredIds.size + 1} of ${state.questions.length}`}
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {actionError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {actionError}
          </div>
        )}
        <p className="text-base font-semibold text-slate-900">
          {currentQuestion.question_text}
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
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
