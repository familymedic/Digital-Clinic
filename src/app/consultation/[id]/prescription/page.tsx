"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { timedFetch } from "@/lib/monitoredFetch";

// Phase 7, step 4 (Section 16): the patient's read-only view of an
// issued prescription. RLS (0018) only ever returns a row here once the
// doctor has explicitly Approved & Issued it — a draft is invisible at
// the database level, not just hidden by this page. Physician-authored
// content is shown plainly as what the doctor decided; nothing here is
// AI-generated (Section 10/11's provenance rule), so there's no AI
// content to visually distinguish from in this view.

interface AssessmentRow {
  assessment: string | null;
  advice: string | null;
  referral: string | null;
  follow_up_date: string | null;
  follow_up_reason: string | null;
  issued_at: string | null;
}

interface MedicationRow {
  id: string;
  medication_name: string;
  dosage: string | null;
  instructions: string | null;
}

interface ConsultationRow {
  complaint: string;
  patient: { full_name: string } | { full_name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function PatientPrescriptionView() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const { session, loading: authLoading } = useAuth();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [assessment, setAssessment] = useState<AssessmentRow | null | undefined>(undefined);
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Branded PDF download (2026-09-27) — hits the server route rather
  // than generating the PDF in the browser, so the Family Medic
  // header/branding and the doctor's name are always assembled from the
  // same server-verified data the on-screen view already trusts, not
  // from anything reconstructable client-side.
  async function handleDownloadPdf() {
    if (!session) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await timedFetch(
        `/api/consultations/${consultationId}/prescription-pdf`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        45_000
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDownloadError(body.error ?? "Couldn't generate the PDF. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `family-medic-prescription-${consultationId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Couldn't download the PDF — the connection may be slow. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);

    const [consultationRes, assessmentRes, medsRes] = await Promise.all([
      supabase
        .from("consultations")
        .select("complaint, patient:family_members(full_name)")
        .eq("id", consultationId)
        .maybeSingle(),
      supabase
        .from("consultation_assessments")
        .select("assessment, advice, referral, follow_up_date, follow_up_reason, issued_at")
        .eq("consultation_id", consultationId)
        .maybeSingle(),
      supabase
        .from("consultation_medications")
        .select("id, medication_name, dosage, instructions")
        .eq("consultation_id", consultationId)
        .order("position", { ascending: true }),
    ]);

    if (consultationRes.error) {
      setLoadError(consultationRes.error.message);
      return;
    }
    setConsultation(consultationRes.data as ConsultationRow | null);

    if (assessmentRes.error) {
      setLoadError(assessmentRes.error.message);
      return;
    }
    // A row only ever comes back here once it's issued — RLS (0018)
    // makes a draft structurally invisible to the patient, so there is
    // no separate "is this a draft" check needed in this component.
    setAssessment(assessmentRes.data as AssessmentRow | null);

    if (medsRes.error) {
      setLoadError(medsRes.error.message);
      return;
    }
    setMedications((medsRes.data ?? []) as MedicationRow[]);
  }, [consultationId, session]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div>
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in to see this.</p>
            <Link href="/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
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
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load this: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (consultation === undefined || assessment === undefined) {
    return (
      <div>
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (consultation === null || assessment === null) {
    // Either this isn't your consultation, or your doctor hasn't issued
    // anything for it yet — RLS makes those look the same, which is the
    // correct, safe default.
    return (
      <div>
        <PageHeader title="Prescription" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Nothing has been issued for this consultation yet.</p>
            <Link href="/dashboard" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
              Back to dashboard
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
        title="Your prescription"
        subtitle={`${consultation.complaint}${patient ? ` · ${patient.full_name}` : ""}`}
      />
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/dashboard" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>

        <p className="text-xs text-slate-400">
          {assessment.issued_at && <>Issued by your doctor {new Date(assessment.issued_at).toLocaleString()}.</>}
        </p>

        {assessment.assessment && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Assessment</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{assessment.assessment}</p>
          </section>
        )}

        {medications.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Prescription</h2>
            <ul className="mt-2 space-y-3">
              {medications.map((m) => (
                <li key={m.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div className="text-sm font-medium text-slate-800">
                    {m.medication_name}
                    {m.dosage ? ` — ${m.dosage}` : ""}
                  </div>
                  {m.instructions && <div className="mt-0.5 text-sm text-slate-600">{m.instructions}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {assessment.advice && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Advice</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{assessment.advice}</p>
          </section>
        )}

        {assessment.referral && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Referral</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{assessment.referral}</p>
          </section>
        )}

        {(assessment.follow_up_date || assessment.follow_up_reason) && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Follow-up</h2>
            <p className="mt-2 text-sm text-slate-700">
              {assessment.follow_up_date && new Date(assessment.follow_up_date).toLocaleDateString()}
              {assessment.follow_up_date && assessment.follow_up_reason ? " — " : ""}
              {assessment.follow_up_reason}
            </p>
          </section>
        )}

        <div className="flex flex-col gap-2">
          {downloadError && <p className="text-xs font-medium text-red-700">{downloadError}</p>}
          <button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
