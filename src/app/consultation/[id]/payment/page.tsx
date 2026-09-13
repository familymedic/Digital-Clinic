"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Phase 10, step 1. This page never trusts the URL it was redirected
// back to as proof of payment — Safepay's own webhook (see
// src/app/api/payments/webhook) is the only thing that ever moves a
// consultation out of 'pending_payment'. This page's job is just to
// read that real status from the database and, if the webhook hasn't
// landed yet, wait a few seconds and check again before telling the
// patient anything is wrong.

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
}

export default function PaymentStatusPage() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const searchParams = useSearchParams();
  const outcome = searchParams.get("outcome"); // "return" | "cancelled" | null
  const { session, loading: authLoading } = useAuth();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("consultations")
      .select("id, complaint, status")
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

  // If we were just redirected back from checkout, the webhook may
  // still be a second or two behind — poll a handful of times before
  // giving up and showing a "still confirming" message.
  useEffect(() => {
    if (outcome !== "return") return;
    if (!consultation || consultation.status !== "pending_payment") return;
    if (pollAttempts >= 8) return;

    pollTimer.current = setTimeout(() => {
      load().then(() => setPollAttempts((n) => n + 1));
    }, 2000);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [outcome, consultation, pollAttempts, load]);

  async function startPayment() {
    if (!supabase) return;
    setStarting(true);
    setStartError(null);
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    if (!authSession) {
      setStartError("Your session isn't valid — please log in again.");
      setStarting(false);
      return;
    }
    try {
      const res = await fetch(`/api/consultations/${consultationId}/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authSession.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error ?? "Couldn't start the payment.");
        setStarting(false);
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setStartError("Couldn't reach the server. Check your connection and try again.");
      setStarting(false);
    }
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Payment" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || consultation === undefined) {
    return (
      <div>
        <PageHeader title="Payment" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Payment" />
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

  if (loadError || consultation === null) {
    return (
      <div>
        <PageHeader title="Payment" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError ?? "This consultation isn't available to you."}
          </div>
        </div>
      </div>
    );
  }

  // Already paid (or completed) — nothing more to do here.
  if (consultation.status !== "pending_payment") {
    return (
      <div>
        <PageHeader title="Payment received" subtitle={consultation.complaint} />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-medium">Thanks — your payment went through.</p>
            <p className="mt-2">This consultation is booked and your doctor can now see it.</p>
          </div>
          <Link
            href="/dashboard"
            className="mt-6 inline-block font-medium text-teal-700 underline underline-offset-2"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Still pending, just redirected back from checkout — give the
  // webhook a few seconds before treating this as "not paid yet".
  if (outcome === "return" && pollAttempts < 8) {
    return (
      <div>
        <PageHeader title="Confirming your payment" subtitle={consultation.complaint} />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <p className="text-sm text-slate-500">
            Just a moment — we&rsquo;re confirming your payment with Safepay…
          </p>
        </div>
      </div>
    );
  }

  // Pending, and either the poll window ran out, checkout was
  // cancelled, or the patient came here directly (e.g. from the
  // dashboard's "Complete payment" link).
  return (
    <div>
      <PageHeader title="Payment required" subtitle={consultation.complaint} />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {outcome === "return"
            ? "We haven't heard back from Safepay confirming this payment yet. If you completed checkout, this can take a minute — otherwise, you can try again below."
            : outcome === "cancelled"
              ? "Checkout was cancelled — this consultation is on hold until payment is completed."
              : "This consultation is on hold until the PKR 500 consultation fee is paid."}
        </div>

        {startError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {startError}
          </div>
        )}

        <button
          onClick={startPayment}
          disabled={starting}
          className="mt-6 w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? "Starting…" : "Pay PKR 500 now"}
        </button>

        <Link
          href="/dashboard"
          className="mt-4 block text-center text-sm font-medium text-teal-700 underline underline-offset-2"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
