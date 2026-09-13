"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import VideoCallJoin from "@/components/VideoCallJoin";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 9, step 1: the doctor's side of the same audio/video call —
// mirrors the patient page, just with the doctor's own guard pattern.

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

export default function DoctorCallPage() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !profile) return;
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
  }, [consultationId, profile]);

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

  if (authLoading || profileChecking) {
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
        <PageHeader title="Call" />
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
        <PageHeader title="Call" />
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
            <Link href="/doctor/queue" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
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
        title={consultation.delivery_mode === "video" ? "Video call" : "Audio call"}
        subtitle={`${consultation.complaint}${patient ? ` · ${patient.full_name}` : ""}`}
      />
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
        <Link
          href={`/doctor/consultations/${consultationId}`}
          className="text-sm font-medium text-teal-700 underline underline-offset-2"
        >
          ← Back to consultation
        </Link>

        {consultation.status === "completed" ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            This consultation has already been completed.
          </div>
        ) : consultation.status === "pending_payment" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This patient hasn&rsquo;t completed payment for this consultation yet.
          </div>
        ) : (
          <VideoCallJoin consultationId={consultationId} accessToken={session.access_token} />
        )}
      </div>
    </div>
  );
}
