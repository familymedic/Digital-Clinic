"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { RELATIONSHIP_LABEL } from "@/lib/family";

// Phase 7, step 2: the clinical workspace (Section 13/14) — the doctor's
// detail view of one consultation. Read-only: patient info, the chief
// complaint, the full guided-history question/answer trail, and the
// safety-event panel. No diagnosis, prescription, or note-writing yet —
// that is the next increment (Section 15).

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
  created_at: string;
  history_status: "not_started" | "in_progress" | "completed";
  is_flagged: boolean;
  patient_language: string | null;
  patient:
    | { full_name: string; relationship: string; date_of_birth: string | null }
    | { full_name: string; relationship: string; date_of_birth: string | null }[]
    | null;
}

interface HistoryResponseRow {
  id: string;
  created_at: string;
  language: string;
  question: { position: number; question_text: string } | { position: number; question_text: string }[] | null;
  answer_option:
    | { label: string; is_red_flag: boolean; red_flag_note: string | null }
    | { label: string; is_red_flag: boolean; red_flag_note: string | null }[]
    | null;
}

interface SafetyEventRow {
  id: string;
  rule_description: string;
  system_action: string;
  status: string;
  created_at: string;
}

interface ConsentRow {
  id: string;
  accepted_at: string;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

const HISTORY_LABEL: Record<ConsultationRow["history_status"], string> = {
  not_started: "History not started",
  in_progress: "History in progress",
  completed: "History complete",
};

export default function DoctorConsultationDetail() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [responses, setResponses] = useState<HistoryResponseRow[] | null>(null);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEventRow[] | null>(null);
  const [consent, setConsent] = useState<ConsentRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !profile) return;
    setLoadError(null);

    const [consultationRes, responsesRes, safetyRes, consentRes] = await Promise.all([
      supabase
        .from("consultations")
        .select(
          "id, complaint, status, created_at, history_status, is_flagged, patient_language, patient:family_members(full_name, relationship, date_of_birth)"
        )
        .eq("id", consultationId)
        .maybeSingle(),
      supabase
        .from("consultation_history_responses")
        .select(
          "id, created_at, language, question:clinical_questions(position, question_text), answer_option:clinical_answer_options(label, is_red_flag, red_flag_note)"
        )
        .eq("consultation_id", consultationId),
      supabase
        .from("consultation_safety_events")
        .select("id, rule_description, system_action, status, created_at")
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("consultation_consents")
        .select("id, accepted_at")
        .eq("consultation_id", consultationId)
        .order("accepted_at", { ascending: false })
        .limit(1),
    ]);

    if (consultationRes.error) {
      setLoadError(consultationRes.error.message);
      return;
    }
    setConsultation(consultationRes.data as ConsultationRow | null);

    if (responsesRes.error) {
      setLoadError(responsesRes.error.message);
      return;
    }
    const sorted = [...((responsesRes.data ?? []) as HistoryResponseRow[])].sort((a, b) => {
      const pa = one(a.question)?.position ?? 0;
      const pb = one(b.question)?.position ?? 0;
      return pa - pb;
    });
    setResponses(sorted);

    if (safetyRes.error) {
      setLoadError(safetyRes.error.message);
      return;
    }
    setSafetyEvents(safetyRes.data as SafetyEventRow[]);

    if (consentRes.error) {
      setLoadError(consentRes.error.message);
      return;
    }
    const consentRows = (consentRes.data ?? []) as ConsentRow[];
    setConsent(consentRows[0] ?? null);
  }, [consultationId, profile]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in with your doctor account first.</p>
            <Link href="/doctor/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t verify your doctor account: {profileError}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as a doctor account.</p>
            <div className="mt-4 flex gap-4">
              <button onClick={() => signOut()} className="font-medium text-teal-700 underline underline-offset-2">
                Log out
              </button>
              <Link href="/doctor/login" className="font-medium text-teal-700 underline underline-offset-2">
                Doctor log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load this consultation: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (consultation === undefined || responses === null || safetyEvents === null) {
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (consultation === null) {
    // Either the id doesn't exist, or it isn't assigned to this doctor —
    // RLS makes those look identical, which is the correct, safe default
    // (no confirmation to a doctor of who someone else's patients are).
    return (
      <div>
        <PageHeader title="Consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>This consultation isn&rsquo;t available to you.</p>
            <Link href="/doctor" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
              Back to queue
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const patient = one(consultation.patient);

  return (
    <div>
      <PageHeader
        title={patient?.full_name ?? "Consultation"}
        subtitle={`${consultation.complaint} · ${HISTORY_LABEL[consultation.history_status]} · ${consultation.status}`}
      />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/doctor" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to queue
        </Link>

        {consultation.is_flagged && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            ⚠ Flagged for priority review
          </div>
        )}

        {/* Patient demographics */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Patient</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
            <dt className="text-slate-400">Name</dt>
            <dd>{patient?.full_name ?? "Unknown"}</dd>
            <dt className="text-slate-400">Relationship to account holder</dt>
            <dd>{patient ? RELATIONSHIP_LABEL[patient.relationship] ?? patient.relationship : "—"}</dd>
            <dt className="text-slate-400">Date of birth</dt>
            <dd>{patient?.date_of_birth ?? "Not provided"}</dd>
            <dt className="text-slate-400">Booked</dt>
            <dd>{new Date(consultation.created_at).toLocaleString()}</dd>
          </dl>
        </section>

        {/* Safety panel — always its own section, never folded into
            history below (Section 14). */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Safety events</h2>
          {safetyEvents.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">None recorded for this consultation.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {safetyEvents.map((ev) => (
                <li key={ev.id} className="rounded-md border border-red-100 bg-red-50 p-3 text-sm">
                  <div className="font-medium text-red-800">{ev.rule_description}</div>
                  <div className="mt-1 text-xs text-red-700">
                    System action: {ev.system_action} · Status: {ev.status} ·{" "}
                    {new Date(ev.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* AI-guided history detail — the literal question/answer
            exchange (Section 14), in the order asked. */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Guided history</h2>
          {responses.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              {consultation.history_status === "not_started"
                ? "The patient hasn't started this yet."
                : "No question/answer responses recorded (this complaint may use the immediate-emergency-redirect flow rather than a questionnaire)."}
            </p>
          ) : (
            <ol className="mt-2 space-y-3">
              {responses.map((r) => {
                const q = one(r.question);
                const a = one(r.answer_option);
                return (
                  <li key={r.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <div className="text-sm font-medium text-slate-800">{q?.question_text ?? "—"}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                      <span>{a?.label ?? "—"}</span>
                      {a?.is_red_flag && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          Red flag
                        </span>
                      )}
                    </div>
                    {a?.is_red_flag && a.red_flag_note && (
                      <div className="mt-1 text-xs text-red-700">{a.red_flag_note}</div>
                    )}
                    <div className="mt-1 text-xs text-slate-400">
                      Shown to patient in: {r.language === "ur-roman" ? "Roman Urdu" : "English"}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {consent ? (
            <>AI-history consent recorded {new Date(consent.accepted_at).toLocaleString()}.</>
          ) : (
            <>No AI-history consent recorded yet for this consultation.</>
          )}
        </section>
      </div>
    </div>
  );
}
