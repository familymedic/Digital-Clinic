"use client";

import { useEffect } from "react";
import Link from "next/link";

// Safety net for a crash in any page below the root layout — without
// this file, Next.js falls back to its own bare, unbranded default error
// screen, and nothing about the failure is visible anywhere the
// physician would actually see it (2026-09-29, physician: "i dont want
// my site to crash leaving me clueless on what actually happened").
//
// This alone doesn't SOLVE "clueless" — it only makes the failure look
// intentional to the person who hit it, with a way back. The actual
// visibility fix is server-side error tracking (Sentry's free tier was
// recommended the same day this was added): once that's wired in, the
// console.error below is exactly where `Sentry.captureException(error)`
// belongs too, so a crash here also reaches the physician by email, not
// just the browser console. Left as a plain console.error for now
// rather than blocking this fix on that signup.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      </div>
      <h1 className="mt-4 text-lg font-bold text-ink-900">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-500">
        This page ran into a problem. It&rsquo;s not something you did — please try again, or head back to the
        homepage. If this keeps happening, let us know through the{" "}
        <Link href="/contact" className="font-semibold text-teal-700 underline underline-offset-2">
          contact page
        </Link>
        .
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-ink-border px-5 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-teal-600 hover:text-teal-700"
        >
          Back to homepage
        </Link>
      </div>
    </div>
  );
}
