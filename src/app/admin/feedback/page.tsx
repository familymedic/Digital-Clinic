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

interface FeedbackRow {
  id: string;
  kind: "review" | "complaint";
  rating: number | null;
  message: string | null;
  status: "open" | "reviewed" | "resolved";
  consultation_id: string | null;
  created_at: string;
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
    const { data, error } = await supabase
      .from("patient_feedback")
      .select("id, kind, rating, message, status, consultation_id, created_at")
      .order("created_at", { ascending: false });

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
                    filter === f ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {f === "all" ? "All" : f === "review" ? "Reviews" : "Complaints"}
                </button>
              ))}
            </div>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            {rows === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <ul className="space-y-3">
                {visible.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          {r.kind === "review" ? "Review" : "Complaint"}
                          {r.rating != null && <span className="text-amber-500">{"★".repeat(r.rating)}</span>}
                        </div>
                        {r.message && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.message}</p>}
                        <div className="mt-1 text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      {r.status !== "reviewed" && (
                        <button
                          onClick={() => setStatus(r.id, "reviewed")}
                          disabled={updating === r.id}
                          className="font-medium text-amber-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          Mark reviewed
                        </button>
                      )}
                      {r.status !== "resolved" && (
                        <button
                          onClick={() => setStatus(r.id, "resolved")}
                          disabled={updating === r.id}
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
