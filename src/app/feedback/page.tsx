"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// The patient-facing half of the admin system's reviews/complaints
// feature (Part 18 of the business audit — a minimum-viable support/
// complaint path, which didn't exist anywhere in the app before this).
// Admin-only visibility per the physician's explicit choice: nothing
// submitted here is shown publicly or to any doctor.
//
// Reachable two ways: a per-consultation "Leave feedback" link once a
// consultation is completed (?consultation=... in the URL), or a
// general "Feedback & support" link with no consultation attached.
//
// BUG FIX (2026-09-30, physician: "i just checked a complaint i saw on
// my admin portal its a good review dropped by a client but i cant see
// who dropped it and its shown as a complaint instead of review"): this
// form used to decide `kind` purely from WHICH LINK the patient clicked
// — arrived via a ?consultation= link, kind was forced to "review";
// arrived via the general link, kind was forced to "complaint", no
// matter what the patient actually typed. A glowing, five-star-worthy
// note sent through the general "Feedback & support" entry point (e.g.
// dashboard.tsx's generic links, not the per-consultation one) was
// therefore always mislabeled a complaint. The fix: when there's no
// consultation tied to it, the patient now explicitly picks "Leave a
// review" or "Report a problem" up front, and THAT choice — not the
// entry link — decides `kind`. The per-consultation path is unchanged
// (it's already an explicit review context with a star rating).

type GeneralIntent = "review" | "complaint";

function FeedbackForm() {
  const searchParams = useSearchParams();
  const consultationId = searchParams.get("consultation");
  const { session, loading: authLoading } = useAuth();

  const [generalIntent, setGeneralIntent] = useState<GeneralIntent | null>(null);
  const [rating, setRating] = useState(consultationId ? 5 : 0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // For the general (no-consultation) path, nothing is a review or a
  // complaint until the patient says which one they mean.
  const kind: GeneralIntent = consultationId ? "review" : generalIntent ?? "complaint";
  const showReviewFields = consultationId ? true : generalIntent === "review";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !session) return;

    if (!consultationId && !generalIntent) {
      setSubmitError("Please choose whether this is a review or a problem to report.");
      return;
    }

    if (!showReviewFields && !message.trim()) {
      setSubmitError("Please describe the issue.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase.from("patient_feedback").insert({
      account_id: session.user.id,
      consultation_id: consultationId || null,
      kind,
      rating: showReviewFields ? rating : null,
      message: message.trim() || null,
    });

    setSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    setSubmitted(true);
  }

  if (!isDatabaseConfigured) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
      </div>
    );
  }

  if (authLoading) {
    return <p className="text-sm text-ink-500">Loading…</p>;
  }

  if (!session) {
    return (
      <div className="rounded-3xl border border-[#d7e7e2] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <p>Please log in first.</p>
        <Link href="/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
          Log in
        </Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
        <p className="font-semibold">Thank you — this has been sent to the clinic.</p>
        <Link href="/dashboard" className="mt-3 inline-block font-medium underline underline-offset-2">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-8">
      {!consultationId && (
        <div>
          <label className="block text-sm font-medium text-ink-700">What&rsquo;s this about?</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setGeneralIntent("review")}
              className={`rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                generalIntent === "review"
                  ? "border-teal-600 bg-teal-50 text-teal-800"
                  : "border-[#d7e7e2] bg-white text-ink-700 hover:border-teal-300"
              }`}
            >
              ★ Leave a review
            </button>
            <button
              type="button"
              onClick={() => setGeneralIntent("complaint")}
              className={`rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                generalIntent === "complaint"
                  ? "border-teal-600 bg-teal-50 text-teal-800"
                  : "border-[#d7e7e2] bg-white text-ink-700 hover:border-teal-300"
              }`}
            >
              ⚠ Report a problem
            </button>
          </div>
        </div>
      )}

      {showReviewFields ? (
        <div>
          <label className="block text-sm font-medium text-ink-700">
            {consultationId ? "How was this consultation?" : "How would you rate your experience?"}
          </label>
          <div className="mt-2 flex gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={n <= rating ? "text-amber-500" : "text-slate-300"}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      ) : (
        !consultationId &&
        generalIntent === "complaint" && (
          <p className="text-sm text-ink-500">
            Use this to report a problem, a billing issue, or anything else you&rsquo;d like the clinic to know about.
            This goes directly to the clinic — it isn&rsquo;t shown to anyone else.
          </p>
        )
      )}

      {(consultationId || generalIntent) && (
        <div>
          <label className="block text-sm font-medium text-ink-700">
            {showReviewFields ? "Any comments (optional)" : "What happened?"}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            className="mt-1.5 w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm text-ink-900"
          />
        </div>
      )}

      {submitError && <p className="text-sm text-red-700">{submitError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

export default function FeedbackPage() {
  return (
    <div>
      <PageHeader title="Feedback & support" subtitle="Tell us about your experience, or report a problem." />
      <div className="mx-auto max-w-md space-y-6 px-4 py-10 sm:px-6">
        <Link href="/dashboard" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>
        <Suspense fallback={<p className="text-sm text-ink-500">Loading…</p>}>
          <FeedbackForm />
        </Suspense>
      </div>
    </div>
  );
}
