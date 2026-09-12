"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import MessageThread from "@/components/MessageThread";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Phase 8 add-on (Section 8/14): the patient's side of the ongoing
// message thread for a text-mode consultation. Only ever shows
// anything for the patient's own consultation, and only while
// delivery_mode is 'text' — RLS also enforces this at the message
// level (0022), this page just presents it plainly.

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

export default function PatientMessagesView() {
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
        <PageHeader title="Messages" />
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
        <PageHeader title="Messages" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Messages" />
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
        <PageHeader title="Messages" />
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
        <PageHeader title="Messages" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (consultation === null || consultation.delivery_mode !== "text") {
    // Either it isn't your consultation, or it isn't a text-mode one —
    // RLS makes the first look the same as "not found", and messaging
    // simply doesn't apply to the second.
    return (
      <div>
        <PageHeader title="Messages" />
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
        title="Messages"
        subtitle={`${consultation.complaint}${patient ? ` · ${patient.full_name}` : ""}`}
      />
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10 sm:px-6">
        <Link href="/dashboard" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <MessageThread
            consultationId={consultationId}
            viewerRole="patient"
            senderId={session.user.id}
            locked={consultation.status === "completed"}
          />
        </section>
      </div>
    </div>
  );
}
