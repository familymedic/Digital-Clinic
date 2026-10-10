"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
//
// Safepay V2 (2026-10): Safepay now sends the patient back with
// "?tracker=track_..." added. That is still NOT treated as proof of
// payment — it only tells us the patient is back, so we immediately ask
// our own server to confirm with Safepay (POST .../payment/confirm),
// which settles the payment the same way the webhook does, usually
// within a second or two instead of waiting for the webhook.

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
  doctor_id: string | null;
  delivery_mode: "text" | "audio" | "video";
}

// Where a patient should land once payment has gone through (2026-10-06:
// the success screen used to be a dead end — "Back to dashboard" — and
// the physician, testing a real consultation, had to find their own way
// back). Text consultations go to the message thread; audio/video go to
// the call page, which is where Join lives.
function consultationHref(c: { id: string; delivery_mode: "text" | "audio" | "video" }): string {
  return c.delivery_mode === "text" ? `/consultation/${c.id}/messages` : `/consultation/${c.id}/call`;
}

// Remembers (in this browser only) that this patient was just sent to
// Safepay for this consultation. Some checkout returns arrive without our
// "?outcome=return" marker, and without this the page could not tell "just
// paid, webhook a moment behind" from "has not paid yet". It is only a hint
// to keep checking; payment is still only ever confirmed from the database.
const CHECKOUT_HINT_MINUTES = 30;
function checkoutHintKey(id: string) {
  return `fm_checkout_started_${id}`;
}
function hasRecentCheckoutHint(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(checkoutHintKey(id));
    if (!raw) return false;
    return Date.now() - Number(raw) < CHECKOUT_HINT_MINUTES * 60 * 1000;
  } catch {
    return false;
  }
}
function setCheckoutHint(id: string) {
  try {
    window.localStorage.setItem(checkoutHintKey(id), String(Date.now()));
  } catch {
    /* storage unavailable: the ?outcome=return marker still works */
  }
}
function clearCheckoutHint(id: string) {
  try {
    window.localStorage.removeItem(checkoutHintKey(id));
  } catch {
    /* ignore */
  }
}

// How long to keep checking for the webhook: 45 checks, 2 seconds apart.
const MAX_POLL_ATTEMPTS = 45;

export default function PaymentStatusPage() {
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const searchParams = useSearchParams();
  const outcomeParam = searchParams.get("outcome"); // "cancelled" | null (older links: "return")
  // Safepay may tack its own "?tracker=" onto our cancel link, so only the start is compared.
  const outcome = outcomeParam?.startsWith("cancelled") ? "cancelled" : outcomeParam === "return" ? "return" : null;
  const returnedTracker = searchParams.get("tracker"); // set by Safepay V2 on the return from checkout
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();

  const [consultation, setConsultation] = useState<ConsultationRow | null | undefined>(undefined);
  const [consultationFee, setConsultationFee] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  // True once we know the patient came back from (or was just sent to)
  // Safepay for this consultation. Never reset during the page's life, so
  // the "payment confirmed" hand-off still works after the hint is cleared.
  const [cameFromCheckout, setCameFromCheckout] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("consultations")
      .select("id, complaint, status, doctor_id, delivery_mode")
      .eq("id", consultationId)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      return;
    }
    const row = data as ConsultationRow | null;
    setConsultation(row);

    if (outcome === "cancelled") {
      clearCheckoutHint(consultationId);
    } else {
      // The patient just came back from (or was just sent to) Safepay.
      // Remember that EVEN IF the payment is already confirmed, so the
      // hand-off to the dashboard happens. (Safepay's confirmation often
      // arrives while the patient is still on Safepay's own success page,
      // so on return the booking is frequently already paid.)
      if (outcome === "return" || !!returnedTracker || hasRecentCheckoutHint(consultationId)) {
        setCameFromCheckout(true);
      }
      if (row && row.status !== "pending_payment") {
        // Paid: the stored hint has done its job.
        clearCheckoutHint(consultationId);
      }
    }

    // The doctor's own fee (Phase 10, step 2) — read from the public
    // directory view, the same publicly-selectable source /doctors and
    // /book already use, rather than doctor_profiles directly (which
    // has no patient-facing SELECT policy). Display-only: the real
    // amount actually charged is always decided server-side, in the
    // payment route itself.
    if (row?.doctor_id) {
      const { data: doctorRow } = await supabase
        .from("public_doctor_directory")
        .select("consultation_fee")
        .eq("id", row.doctor_id)
        .maybeSingle();
      setConsultationFee((doctorRow?.consultation_fee as number | undefined) ?? null);
    }
  }, [consultationId, session, outcome, returnedTracker]);

  useEffect(() => {
    load();
  }, [load]);

  // Asks our server to check with Safepay whether this payment finished
  // (V2). Harmless if it hasn't: the server just answers "pending".
  const confirmPayment = useCallback(async () => {
    if (!supabase) return;
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession) return;
      await fetch(`/api/consultations/${consultationId}/payment/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authSession.access_token}` },
      });
    } catch {
      /* the webhook can still settle it; the next check will try again */
    }
  }, [consultationId]);

  // If we were just redirected back from checkout, keep checking: ask the
  // server to confirm with Safepay right away (and every few checks after
  // that), and re-read the real status from the database each time.
  useEffect(() => {
    if (!cameFromCheckout) return;
    if (!consultation || consultation.status !== "pending_payment") return;
    if (pollAttempts >= MAX_POLL_ATTEMPTS) return;

    pollTimer.current = setTimeout(
      () => {
        (pollAttempts % 3 === 0 ? confirmPayment() : Promise.resolve())
          .then(() => load())
          .then(() => setPollAttempts((n) => n + 1));
      },
      pollAttempts === 0 ? 300 : 2000
    );
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [cameFromCheckout, consultation, pollAttempts, load, confirmPayment]);

  // Just paid (came back from checkout and the webhook has confirmed it):
  // take the patient straight to their consultation after a short pause,
  // long enough to read the confirmation. Only on the return from
  // checkout — someone opening this page later from the dashboard is not
  // pushed anywhere.
  const justPaid = cameFromCheckout && !!consultation && consultation.status !== "pending_payment";
  useEffect(() => {
    if (!justPaid) return;
    const t = setTimeout(() => router.replace("/dashboard"), 1500);
    return () => clearTimeout(t);
  }, [justPaid, router]);

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
      setCheckoutHint(consultationId);
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
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-ink-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Payment" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-3xl border border-[#d7e7e2] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
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
        <PageHeader title="Payment confirmed" subtitle={consultation.complaint} />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-medium">Thank you — your payment is confirmed and your appointment is booked.</p>
            <p className="mt-2">Your doctor can now see your consultation.</p>
            {justPaid && <p className="mt-2 text-teal-800">Taking you to your dashboard…</p>}
          </div>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Go to my dashboard
          </Link>
          <Link
            href={consultationHref(consultation)}
            className="mt-4 block text-center text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            {consultation.delivery_mode === "text" ? "Open your consultation" : "Open your call page"}
          </Link>
        </div>
      </div>
    );
  }

  // Still pending, and the patient just came back from (or was just sent
  // to) Safepay: give the webhook time to arrive. Calm wording on
  // purpose — this is a normal wait, not a problem.
  if (cameFromCheckout && pollAttempts < MAX_POLL_ATTEMPTS) {
    return (
      <div>
        <PageHeader title="Please wait" subtitle={consultation.complaint} />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-6 text-sm text-sky-900">
            <p className="flex items-center gap-3 font-medium">
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
              />
              Please wait — we are confirming your payment with Safepay.
            </p>
            <p className="mt-2 text-sky-800">
              This usually takes a few seconds. Please don&rsquo;t close or refresh this page; we&rsquo;ll take you to
              your dashboard as soon as your appointment is confirmed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Pending, and we waited the full time after a checkout: still not
  // confirmed. Never offer "Pay again" here — the first payment may simply
  // be slow to arrive, and a second payment would charge them twice.
  if (cameFromCheckout) {
    return (
      <div>
        <PageHeader title="Still confirming" subtitle={consultation.complaint} />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-6 text-sm text-sky-900">
            <p className="font-medium">We are still waiting for Safepay to confirm your payment.</p>
            <p className="mt-2 text-sky-800">
              If you completed checkout, your payment is safe and your appointment will appear on your dashboard
              shortly. This can sometimes take a few minutes.
            </p>
          </div>
          <button
            onClick={() => setPollAttempts(0)}
            className="mt-6 w-full rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Check again
          </button>
          <Link
            href="/dashboard"
            className="mt-4 block text-center text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            Go to my dashboard
          </Link>
          <button
            onClick={() => {
              clearCheckoutHint(consultationId);
              window.location.replace(`/consultation/${consultationId}/payment`);
            }}
            className="mt-6 block w-full text-center text-xs text-ink-500 underline underline-offset-2"
          >
            I didn&rsquo;t complete the payment
          </button>
        </div>
      </div>
    );
  }

  // Pending, and the patient came here directly (e.g. from the dashboard's
  // "Complete payment" link) or cancelled checkout.
  return (
    <div>
      <PageHeader title="Payment required" subtitle={consultation.complaint} />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-[#d7e7e2] bg-[#f1f8f5] p-4 text-sm text-ink-700">
          {outcome === "cancelled"
            ? "Checkout wasn\u2019t completed and no payment was taken. You can pay whenever you\u2019re ready."
            : `Your consultation will be confirmed once ${
                consultationFee != null ? `the PKR ${consultationFee} consultation fee is` : "the consultation fee is"
              } paid.`}
        </div>

        {startError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {startError}
          </div>
        )}

        <button
          onClick={startPayment}
          disabled={starting}
          className="mt-6 w-full rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? "Starting…" : consultationFee != null ? `Pay PKR ${consultationFee} now` : "Pay now"}
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
