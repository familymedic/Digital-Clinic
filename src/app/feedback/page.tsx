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
// Reachable two ways: a general "Contact / report an issue" link (no
// ?consultation= param — becomes a `complaint` with no consultation
// tied to it) or a per-consultation "Leave feedback" link once a
// consultation is completed (becomes a `review`, with a star rating).

function FeedbackForm() {
  const searchParams = useSearchParams();
  const consultationId = searchParams.get("consultation");
  const { session, loading: authLoading } = useAuth();

  const [rating, setRating] = useState(consultationId ? 5 : 0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !session) return;

    if (!consultationId && !message.trim()) {
      setSubmitError("Please describe the issue.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase.from("patient_feedback").insert({
      account_id: session.user.id,
      consultation_id: consultationId || null,
      kind: consultationId ? "review" : "complaint",
      rating: consultationId ? rating : null,
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
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (!session) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
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
    <form onSubmit={handleSubmit} className="space-y-5">
      {consultationId ? (
        <div>
          <label className="block text-sm font-medium text-slate-700">How was this consultation?</label>
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
        <p className="text-sm text-slate-500">
          Use this to report a problem, a billing issue, or anything else you&rsquo;d like the clinic to know about.
          This goes directly to the clinic — it isn&rsquo;t shown to anyone else.
        </p>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700">
          {consultationId ? "Any comments (optional)" : "What happened?"}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      {submitError && <p className="text-sm text-red-700">{submitError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
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
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <FeedbackForm />
        </Suspense>
      </div>
    </div>
  );
}
