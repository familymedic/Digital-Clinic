"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// 2026-09-18: the actual "book a free follow-up" mechanism, distinct
// from FollowUpSettings (which only ever records a standard/waived
// NOTE on a follow-up consultation that was already booked and paid
// for normally — confirmed, by reading the payment route directly, to
// have zero effect on charging). This component is the doctor-side
// half of the real thing: from an already-completed consultation, the
// doctor issues a one-time voucher for this specific patient with this
// specific doctor. The patient then sees a "book your free follow-up"
// option on their dashboard (see the dashboard's own voucher banner)
// that creates the next consultation directly as 'submitted' — no
// payment step at all — via the redeem_followup_voucher() function.
// Every rule (only the assigned doctor, only from a completed
// consultation, one active voucher per origin) is enforced server-side
// by issue_followup_voucher()/revoke_followup_voucher() (0041) — this
// component is just the UI around them, not a second source of truth.

interface Voucher {
  id: string;
  status: "active" | "consumed" | "revoked";
  note: string | null;
  expires_at: string | null;
  created_at: string;
  consumed_at: string | null;
}

interface Props {
  consultationId: string;
  consultationStatus: string;
}

const EXPIRY_OPTIONS = [
  { label: "No expiry", value: "" },
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
];

export default function FreeFollowUpVoucher({ consultationId, consultationStatus }: Props) {
  const [voucher, setVoucher] = useState<Voucher | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("consultation_followup_vouchers")
      .select("id, status, note, expires_at, created_at, consumed_at")
      .eq("origin_consultation_id", consultationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      return;
    }
    setVoucher(data as Voucher | null);
  }, [consultationId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleIssue() {
    if (!supabase) return;
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabase.rpc("issue_followup_voucher", {
      p_consultation_id: consultationId,
      p_note: note.trim() || null,
      p_expires_in_days: expiryDays ? Number(expiryDays) : null,
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setShowForm(false);
    setNote("");
    setExpiryDays("");
    await load();
  }

  async function handleRevoke() {
    if (!supabase || !voucher) return;
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabase.rpc("revoke_followup_voucher", { p_voucher_id: voucher.id });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    await load();
  }

  if (loadError) {
    return <p className="text-sm text-red-700">Couldn&rsquo;t load free follow-up status: {loadError}</p>;
  }

  if (voucher === undefined) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  if (consultationStatus !== "completed" && !voucher) {
    return (
      <p className="text-sm text-slate-400">
        A free follow-up can be granted once this consultation is completed.
      </p>
    );
  }

  if (voucher?.status === "active") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-teal-700">Free follow-up granted</span> on{" "}
          {new Date(voucher.created_at).toLocaleDateString()}
          {voucher.expires_at && ` — expires ${new Date(voucher.expires_at).toLocaleDateString()}`}.
          Not yet used.
        </p>
        {voucher.note && <p className="text-xs text-slate-500">Note: {voucher.note}</p>}
        {actionError && <p className="text-xs text-red-700">{actionError}</p>}
        <button
          onClick={handleRevoke}
          disabled={submitting}
          className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-60"
        >
          {submitting ? "Revoking…" : "Revoke it"}
        </button>
      </div>
    );
  }

  if (voucher?.status === "consumed") {
    return (
      <p className="text-sm text-slate-500">
        Free follow-up granted {new Date(voucher.created_at).toLocaleDateString()} — used
        {voucher.consumed_at && ` on ${new Date(voucher.consumed_at).toLocaleDateString()}`}. The patient has
        already booked their free visit.
      </p>
    );
  }

  // No active voucher (none ever issued, or the last one was revoked).
  return (
    <div className="space-y-3">
      {voucher?.status === "revoked" && (
        <p className="text-xs text-slate-400">
          A previous free follow-up (granted {new Date(voucher.created_at).toLocaleDateString()}) was revoked.
        </p>
      )}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm font-semibold text-teal-700 underline underline-offset-2"
        >
          Allow a free follow-up for this patient
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs text-teal-900">
            The patient will be able to book their next consultation with you at no charge — no payment
            page at all for that one visit.
          </p>
          <label className="block text-xs font-medium text-slate-600">
            Note for your own reference (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Review in 2 weeks"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Expires
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {actionError && <p className="text-xs text-red-700">{actionError}</p>}
          <div className="flex gap-3">
            <button
              onClick={handleIssue}
              disabled={submitting}
              className="rounded-md bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Granting…" : "Grant free follow-up"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              disabled={submitting}
              className="text-xs font-medium text-slate-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
