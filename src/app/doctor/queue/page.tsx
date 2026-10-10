"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
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
  doctor_archived_at: string | null;
  delivery_mode: "text" | "audio" | "video";
  scheduled_slot: { start_time: string } | { start_time: string }[] | null;
  patient: { full_name: string } | { full_name: string }[] | null;
}

const DELIVERY_MODE_LABEL: Record<QueueRow["delivery_mode"], string> = {
  text: "Text",
  audio: "Audio call",
  video: "Video call",
};

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function patientName(row: QueueRow): string {
  if (!row.patient) return "Unknown patient";
  return Array.isArray(row.patient) ? row.patient[0]?.full_name ?? "Unknown patient" : row.patient.full_name;
}

export default function DoctorQueue() {
  const router = useRouter();
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Archive / restore (2026-10-06). Never a delete: consultations are
  // clinical and financial records. Archiving only hides the row from
  // THIS doctor's queue; admin and the patient still see it. The server
  // function refuses anything recent or upcoming (see 0064).
  async function setArchived(id: string, archive: boolean) {
    if (!supabase) return;
    setBusyId(id);
    setActionError(null);
    const { error } = await supabase.rpc("doctor_archive_consultation", {
      p_consultation_id: id,
      p_archive: archive,
    });
    setBusyId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.id === id ? { ...r, doctor_archived_at: archive ? new Date().toISOString() : null } : r
          )
        : prev
    );
  }

  useEffect(() => {
    if (!session || !supabase || !profile) return;
    supabase
      .from("consultations")
      .select(
        "id, complaint, status, created_at, history_status, is_flagged, doctor_archived_at, delivery_mode, scheduled_slot:doctor_availability_slots(start_time), patient:family_members(full_name)"
      )
      // Phase 10: a booking that hasn't been paid for yet doesn't exist
      // for the doctor at all — commercial state (has this been paid?)
      // stays out of the clinical queue entirely, rather than showing
      // up as "assigned work" before it's real.
      .neq("status", "pending_payment")
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
      <DoctorShell active="queue">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
      </DoctorShell>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <DoctorShell active="queue">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  if (!session) {
    return (
      <DoctorShell active="queue">
        <div className="mx-auto max-w-md rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <p>Please log in with your doctor account first.</p>
          <Link
            href="/doctor/login"
            className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2"
          >
            Doctor log in
          </Link>
        </div>
      </DoctorShell>
    );
  }

  if (profileError) {
    return (
      <DoctorShell active="queue">
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }

  if (!profile) {
    // A real session exists, but it's not a doctor account — most likely
    // someone is signed in here as a patient. Don't show them anything.
    return (
      <DoctorShell active="queue">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <div className="mt-4 flex gap-4">
            <button
              onClick={() => signOut()}
              className="font-semibold text-teal-700 underline underline-offset-2"
            >
              Log out
            </button>
            <Link href="/doctor/login" className="font-semibold text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </DoctorShell>
    );
  }

  const activeRows = (rows ?? []).filter((r) => !r.doctor_archived_at);
  const archivedRows = (rows ?? []).filter((r) => r.doctor_archived_at);
  const shownRows = tab === "active" ? activeRows : archivedRows;

  return (
    <DoctorShell active="queue" doctorName={profile.full_name} onSignOut={signOut}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
            Consultation Queue
          </h1>
          <p className="mt-1 text-sm text-ink-500">{activeRows.length} active, most recent first</p>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold transition ${
              tab === t
                ? "border-teal-600 bg-teal-50 text-teal-700"
                : "border-[#dcebe6] bg-white text-ink-500 hover:text-teal-700"
            }`}
          >
            {t === "active" ? `Active (${activeRows.length})` : `Archived (${archivedRows.length})`}
          </button>
        ))}
      </div>
      {actionError && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {actionError}
        </div>
      )}

      {rowsError && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load the queue: {rowsError}
        </div>
      )}

      {!rowsError && rows === null && (
        <p className="mt-6 text-sm text-ink-400">Loading…</p>
      )}

      {!rowsError && rows && shownRows.length === 0 && (
        <div className="mt-6 rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-500 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          {tab === "active"
            ? rows.length === 0
              ? "No consultations assigned to you yet."
              : "Nothing active in your queue."
            : "No archived consultations."}
        </div>
      )}

      {/* Table, not cards (2026-09-20, physician: wanted a denser,
          more clinical/EHR-style view for scanning many patients at
          once) — same rows, same fields, same click-through as
          before; only the layout changed. A flagged row gets a thin
          red left border rather than its own separate badge line, so
          it reads at a glance without adding visual noise for the
          common case. */}
      {!rowsError && rows && shownRows.length > 0 && (
        <div className="relative mt-6 overflow-x-auto rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#dcebe6] bg-[var(--background)] text-[11px] font-bold uppercase tracking-wide text-ink-400">
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Complaint</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Booked</th>
                <th className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => {
                const slot = row.delivery_mode !== "text" ? one(row.scheduled_slot) : null;
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/doctor/consultations/${row.id}`)}
                    className={`cursor-pointer border-b border-[#dcebe6] last:border-b-0 transition hover:bg-teal-50/40 ${
                      row.is_flagged ? "border-l-[3px] border-l-red-500" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-ink-900">
                      <div className="flex items-center gap-2">
                        {patientName(row)}
                        {row.is_flagged && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-bold text-red-700">
                            Priority
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-ink-700">{row.complaint}</td>
                    <td className="px-4 py-3 text-ink-500">
                      {DELIVERY_MODE_LABEL[row.delivery_mode]}
                      {slot && (
                        <span className="block text-[11px] text-ink-400">
                          {new Date(slot.start_time).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      {row.delivery_mode !== "text" && !slot && (
                        <span className="block text-[11px] font-semibold text-amber-700">needs scheduling</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-500">{row.status}</td>
                    <td className="px-4 py-3 text-right text-[11.5px] text-ink-400">
                      {new Date(row.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchived(row.id, !row.doctor_archived_at);
                        }}
                        disabled={busyId === row.id}
                        className="whitespace-nowrap text-[12px] font-semibold text-teal-700 underline underline-offset-2 disabled:opacity-50"
                      >
                        {busyId === row.id ? "…" : row.doctor_archived_at ? "Restore" : "Archive"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DoctorShell>
  );
}
