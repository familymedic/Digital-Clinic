"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Admin system, step 2: payments & refunds. A refund is a manual admin
// decision, for a manually-decided amount, processed for real in
// Safepay's own dashboard first (this app has no refund API integration
// — Section 41/8 of the business audit both flag this as a real, still-
// open gap) — this screen only RECORDS that it happened, which is what
// then excludes that consultation from the doctor's payout (see
// /admin/payouts).

interface PaymentRow {
  id: string;
  consultation_id: string;
  amount: number;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  refunded_amount: number | null;
  refunded_at: string | null;
  refund_note: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<PaymentRow["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  succeeded: "bg-teal-100 text-teal-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-600",
};

export default function AdminRefunds() {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("payments")
      .select("id, consultation_id, amount, status, refunded_amount, refunded_at, refund_note, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as PaymentRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startRefund(row: PaymentRow) {
    setRefundingId(row.id);
    setRefundAmount(String(row.amount));
    setRefundNote("");
    setSaveError(null);
  }

  async function saveRefund(row: PaymentRow) {
    if (!supabase) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > row.amount) {
      setSaveError(`Enter an amount between 1 and ${row.amount}.`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from("payments")
      .update({
        refunded_amount: amount,
        refunded_at: new Date().toISOString(),
        refund_note: refundNote.trim() || null,
      })
      .eq("id", row.id);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setRefundingId(null);
    await load();
  }

  return (
    <AdminGuard title="Payments & refunds">
      {() => (
        <div>
          <PageHeader
            title="Payments & refunds"
            subtitle="Record a refund here only after actually processing it in Safepay's dashboard."
          />
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            {rows === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-400">No payments recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">PKR {r.amount}</div>
                        <div className="text-xs text-slate-400">
                          Consultation {r.consultation_id.slice(0, 8)}… · {new Date(r.created_at).toLocaleString()}
                        </div>
                        {r.refunded_amount != null && (
                          <div className="mt-1 text-xs font-medium text-amber-700">
                            Refunded PKR {r.refunded_amount} on{" "}
                            {r.refunded_at ? new Date(r.refunded_at).toLocaleDateString() : ""}
                            {r.refund_note ? ` — ${r.refund_note}` : ""}
                          </div>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                        {r.status}
                      </span>
                    </div>

                    {r.status === "succeeded" && r.refunded_amount == null && (
                      <div className="mt-3">
                        {refundingId === r.id ? (
                          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                            <label className="block text-xs font-medium text-slate-600">
                              Refund amount (PKR, up to {r.amount})
                              <input
                                type="number"
                                value={refundAmount}
                                onChange={(e) => setRefundAmount(e.target.value)}
                                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-600">
                              Note (optional)
                              <input
                                value={refundNote}
                                onChange={(e) => setRefundNote(e.target.value)}
                                placeholder="Reason, Safepay reference, etc."
                                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                              />
                            </label>
                            {saveError && <p className="text-xs text-red-700">{saveError}</p>}
                            <div className="flex gap-3">
                              <button
                                onClick={() => saveRefund(r)}
                                disabled={saving}
                                className="rounded-md bg-amber-700 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                {saving ? "Saving…" : "Confirm refund recorded"}
                              </button>
                              <button
                                onClick={() => setRefundingId(null)}
                                disabled={saving}
                                className="text-xs font-medium text-slate-500"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => startRefund(r)}
                            className="text-xs font-medium text-amber-700 underline underline-offset-2"
                          >
                            Record a refund
                          </button>
                        )}
                      </div>
                    )}
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
