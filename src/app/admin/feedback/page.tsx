"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Admin system, step 2: reviews & complaints. Admin-only visibility for
// now, per explicit physician instruction (2026-09-14) — nothing here is
// shown publicly or to doctors yet; that's a deliberate later decision,
// not an oversight.
//
// BUG FIX (2026-09-30, physician: "i cant see who dropped it"): this
// page used to select straight from patient_feedback, which has no
// submitter name on it at all — only an account_id, and patient_profiles
// has no admin-read policy (deliberately, so no admin page bulk-reads
// patient names by accident — see 0040's own notes on this). Switched
// to the admin_feedback_rows() security-definer function (0052), the
// same "expose only what's needed" pattern already used for patient
// counts, which attaches the submitter's name and phone to each row an
// admin is already allowed to see.

interface FeedbackRow {
  feedback_id: string;
  kind: "review" | "complaint";
  rating: number | null;
  message: string | null;
  status: "open" | "reviewed" | "resolved";
  consultation_id: string | null;
  created_at: string;
  submitter_name: string | null;
  submitter_phone: string | null;
  featured_for_marketing: boolean;
}

const STATUS_STYLE: Record<FeedbackRow["status"], string> = {
  open: "bg-red-100 text-red-800",
  reviewed: "bg-amber-100 text-amber-800",
  resolved: "bg-teal-100 text-teal-800",
};

export default function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "review" | "complaint">("all");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("admin_feedback_rows");

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as FeedbackRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: FeedbackRow["status"]) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase.from("patient_feedback").update({ status }).eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  // Featured reviews on the homepage (2026-09-30/10-01, physician:
  // "display good reviews on main the main page for marketing"). Only
  // ever toggleable here, on a review — never a complaint, and the
  // public view (0054) enforces that independently too, so this button
  // simply isn't shown for a complaint row at all.
  async function toggleFeatured(id: string, next: boolean) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("patient_feedback")
      .update({ featured_for_marketing: next, featured_at: next ? new Date().toISOString() : null })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  const visible = (rows ?? []).filter((r) => filter === "all" || r.kind === filter);

  return (
    <AdminGuard title="Reviews & complaints">
      {() => (
        <div>
          <PageHeader title="Reviews & complaints" subtitle="Admin-only for now — nothing here is shown publicly." />
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            <div className="flex gap-3 text-xs">
              {(["all", "review", "complaint"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 font-medium ${
                    filter === f ? "bg-teal-700 text-white" : "bg-[#e6f1ed] text-ink-700"
                  }`}
                >
                  {f === "all" ? "All" : f === "review" ? "Reviews" : "Complaints"}
                </button>
              ))}
            </div>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            {rows === null ? (
              <p className="text-sm text-ink-500">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing here yet.</p>
            ) : (
              <ul className="space-y-3">
                {visible.map((r) => (
                  <li key={r.feedback_id} className="rounded-2xl border border-[#d7e7e2] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                          {r.kind === "review" ? "Review" : "Complaint"}
                          {r.rating != null && <span className="text-amber-500">{"★".repeat(r.rating)}</span>}
                        </div>
                        <div className="mt-0.5 text-xs font-medium text-ink-500">
                          {r.submitter_name || "Unknown patient"}
                          {r.submitter_phone && <span className="text-ink-500"> · {r.submitter_phone}</span>}
                        </div>
                        {r.message && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{r.message}</p>}
                        <div className="mt-1 text-xs text-ink-500">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                          {r.status}
                        </span>
                        {r.featured_for_marketing && (
                          <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                            On homepage
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      {r.kind === "review" && (
                        <button
                          onClick={() => toggleFeatured(r.feedback_id, !r.featured_for_marketing)}
                          disabled={updating === r.feedback_id}
                          className="font-medium text-purple-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          {r.featured_for_marketing ? "Remove from homepage" : "Feature on homepage"}
                        </button>
                      )}
                      {r.status !== "reviewed" && (
                        <button
                          onClick={() => setStatus(r.feedback_id, "reviewed")}
                          disabled={updating === r.feedback_id}
                          className="font-medium text-amber-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          Mark reviewed
                        </button>
                      )}
                      {r.status !== "resolved" && (
                        <button
                          onClick={() => setStatus(r.feedback_id, "resolved")}
                          disabled={updating === r.feedback_id}
                          className="font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          Mark resolved
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
