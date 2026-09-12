"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 7, step 1: the consultation queue — the first, deliberately
// small piece of the doctor dashboard (Section 13/14). Read-only: who
// is this patient, why are they here, and is anything flagged. Each row
// now links into the clinical workspace detail view (step 2).

interface QueueRow {
  id: string;
  complaint: string;
  status: string;
  created_at: string;
  history_status: "not_started" | "in_progress" | "completed";
  is_flagged: boolean;
  delivery_mode: "text" | "audio" | "video";
  patient: { full_name: string } | { full_name: string }[] | null;
}

const DELIVERY_MODE_LABEL: Record<QueueRow["delivery_mode"], string> = {
  text: "Text",
  audio: "Audio call",
  video: "Video call",
};

const HISTORY_LABEL: Record<QueueRow["history_status"], string> = {
  not_started: "History not started",
  in_progress: "History in progress",
  completed: "History complete",
};

function patientName(row: QueueRow): string {
  if (!row.patient) return "Unknown patient";
  return Array.isArray(row.patient) ? row.patient[0]?.full_name ?? "Unknown patient" : row.patient.full_name;
}

export default function DoctorQueue() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase || !profile) return;
    supabase
      .from("consultations")
      .select(
        "id, complaint, status, created_at, history_status, is_flagged, delivery_mode, patient:family_members(full_name)"
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setRowsError(error.message);
        } else {
          setRows(data as QueueRow[]);
        }
      });
  }, [session, profile]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Consultation Queue" />
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
        <PageHeader title="Consultation Queue" />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Consultation Queue" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in with your doctor account first.</p>
            <Link
              href="/doctor/login"
              className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2"
            >
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
        <PageHeader title="Consultation Queue" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t verify your doctor account: {profileError}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    // A real session exists, but it's not a doctor account — most likely
    // someone is signed in here as a patient. Don't show them anything.
    return (
      <div>
        <PageHeader title="Consultation Queue" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as a doctor account.</p>
            <div className="mt-4 flex gap-4">
              <button
                onClick={() => signOut()}
                className="font-medium text-teal-700 underline underline-offset-2"
              >
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

  return (
    <div>
      <PageHeader
        title="Consultation Queue"
        subtitle={`Signed in as ${profile.full_name}`}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href="/doctor" className="mb-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>

        {rowsError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load the queue: {rowsError}
          </div>
        )}

        {!rowsError && rows === null && (
          <p className="text-sm text-slate-400">Loading…</p>
        )}

        {!rowsError && rows && rows.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
            No consultations assigned to you yet.
          </div>
        )}

        {!rowsError && rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/doctor/consultations/${row.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-teal-600"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{patientName(row)}</span>
                    {row.is_flagged && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        ⚠ Priority review
                      </span>
                    )}
                    {row.delivery_mode !== "text" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {DELIVERY_MODE_LABEL[row.delivery_mode]} · needs scheduling
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.complaint} · {HISTORY_LABEL[row.history_status]} · {row.status}
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(row.created_at).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
