"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// The Safepay way to pay the platform fee (migration 0076): one button,
// PKR 2,500, 30 days of access. Shown by SubscriptionPaymentPanel instead
// of the bank/JazzCash proof form for doctors who have the Safepay
// checkout switched on. The amount is fixed on the server — nothing here
// can change it. The doctor is sent to Safepay's own secure page, pays
// there, and comes back to /doctor/access-return, which confirms the
// payment and unlocks the workspace.

const FEE_LABEL = "PKR 2,500";

export default function DoctorSafepayPanel({ doctorId }: { doctorId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofPending, setProofPending] = useState(false);

  // If a bank/JazzCash proof is still waiting for the clinic, say so, so
  // nobody pays twice by accident. Purely informational.
  useEffect(() => {
    if (!supabase || !doctorId) return;
    Promise.resolve(
      supabase
        .from("doctor_subscription_payment_proofs")
        .select("status")
        .eq("doctor_id", doctorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).then(
      ({ data }) => setProofPending((data as { status?: string } | null)?.status === "pending"),
      () => setProofPending(false)
    );
  }, [doctorId]);

  async function pay() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError("Your session has expired — please log in again.");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/doctor/access/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !json.checkoutUrl) {
        setError(json.error || "Couldn't start the payment. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(json.checkoutUrl);
    } catch {
      setError("Couldn't reach the payment service. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-left">
      {proofPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have a bank/JazzCash payment proof waiting for review. If you already paid that way, you don&rsquo;t
          need to pay again &mdash; the clinic will activate your access.
        </div>
      )}
      <div className="rounded-2xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <div className="text-xs font-bold uppercase tracking-wide text-ink-400">Pay online with Safepay</div>
        <p className="mt-2 text-sm text-ink-700">
          {FEE_LABEL} gives you full access to your workspace for 30 days. You&rsquo;ll choose your payment method on
          Safepay&rsquo;s secure page, and your access starts automatically as soon as the payment is confirmed.
        </p>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <button
          onClick={pay}
          disabled={busy}
          className="mt-4 w-full rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"
        >
          {busy ? "Opening Safepay…" : `Pay ${FEE_LABEL} with Safepay`}
        </button>
        <p className="mt-2 text-center text-xs text-ink-400">You won&rsquo;t be charged until you confirm on Safepay.</p>
      </div>
    </div>
  );
}
