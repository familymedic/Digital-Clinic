"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import VideoCallJoin from "@/components/VideoCallJoin";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Phase 9, step 1 (Section 23/35): the patient's side of an audio/video
// consultation. Only ever available for the patient's own audio/video
// consultations — RLS backs this up at the API-route level too (see
// src/app/api/consultations/[id]/room).

interface ConsultationRow {
  complaint: string;
  delivery_mode: "text" | "audio" | "video";
  status: string;
  patient: { full_name: string } | { full_name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function PatientCallPage() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const { session, loading: authLoading } = useAuth();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);
    const { data, error } = await supabase
      .from("consultations")
      .select("complaint, delivery_mode, status, patient:family_members(full_name)")
      .eq("id", consultationId)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      return;
    }
    setConsultation(data as ConsultationRow | null);
  }, [consultationId, session]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Call" />
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
        <PageHeader title="Call" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Call" />
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
        <PageHeader title="Call" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load this: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (consultation === undefined) {
    return (
      <div>
        <PageHeader title="Call" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (consultation === null || consultation.delivery_mode === "text") {
    return (
      <div>
        <PageHeader title="Call" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>This isn&rsquo;t available for this consultation.</p>
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
        title={consultation.delivery_mode === "video" ? "Video call" : "Audio call"}
        subtitle={`${consultation.complaint}${patient ? ` · ${patient.full_name}` : ""}`}
      />
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
        <Link href="/dashboard" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>

        {consultation.status === "completed" ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            This consultation has already been completed.
          </div>
        ) : consultation.status === "pending_payment" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This consultation is on hold until payment is completed.</p>
            <Link
              href={`/consultation/${consultationId}/payment`}
              className="mt-4 inline-block font-medium underline underline-offset-2"
            >
              Complete payment
            </Link>
          </div>
        ) : (
          <VideoCallJoin consultationId={consultationId} accessToken={session.access_token} />
        )}
      </div>
    </div>
  );
}
