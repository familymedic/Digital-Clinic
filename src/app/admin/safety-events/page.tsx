"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Admin system, step 1: the piece the audit called highest-leverage —
// reviewing every safety-flagged consultation across all doctors,
// without needing a migration or Claude involved. `consultation_safety_events`
// and its 'open'/'reviewed'/'resolved' status already existed (Phase 6,
// 0004) with nowhere to act on it; this is that missing screen.

interface SafetyEventRow {
  id: string;
  consultation_id: string;
  rule_description: string;
  system_action: string;
  status: "open" | "reviewed" | "resolved";
  created_at: string;
}

const STATUS_STYLE: Record<SafetyEventRow["status"], string> = {
  open: "bg-red-100 text-red-800",
  reviewed: "bg-amber-100 text-amber-800",
  resolved: "bg-teal-100 text-teal-800",
};

export default function AdminSafetyEvents() {
  const [rows, setRows] = useState<SafetyEventRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("consultation_safety_events")
      .select("id, consultation_id, rule_description, system_action, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as SafetyEventRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: SafetyEventRow["status"]) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase.from("consultation_safety_events").update({ status }).eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  return (
    <AdminGuard title="Safety flags">
      {() => (
        <div>
          <PageHeader title="Safety flags" subtitle="Every red-flag event, across every doctor." />
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                Couldn&rsquo;t load this: {loadError}
              </div>
            )}

            {rows === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-400">No safety events recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{r.rule_description}</div>
                        <div className="mt-1 text-xs text-slate-500">{r.system_action}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {new Date(r.created_at).toLocaleString()}
                        </div>
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
                      {r.status !== "open" && (
                        <button
                          onClick={() => setStatus(r.id, "open")}
                          disabled={updating === r.id}
                          className="font-medium text-slate-500 underline underline-offset-2 disabled:opacity-50"
                        >
                          Reopen
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
