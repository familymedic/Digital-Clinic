"use client";

import { useState } from "react";
import Link from "next/link";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s-]{6,}$/;

// The "no account" door into booking (2026-09-30, physician: "is there
// a passage where we can offer patients to consult without registering
// for those who dont want to register?"). Sits next to the existing
// Log in / Create an account links on /book.
//
// Submitting this creates a real account behind the scenes (see
// src/app/api/guest/start/route.ts) and signs the patient straight in
// — from that point on, the rest of /book behaves exactly like it does
// for any other logged-in patient, because AuthProvider's own
// onAuthStateChange listener picks up the new session and the parent
// page re-renders past its "not logged in" gate on its own. This
// component's only job is collecting the few fields needed to get
// there.
export default function GuestQuickStart() {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (phone.trim() && !PHONE_RE.test(phone.trim())) {
      setError("Please enter a valid phone number, or leave this blank.");
      return;
    }
    if (!agreeTerms) {
      setError("Please agree to the Terms and Privacy Policy to continue.");
      return;
    }
    if (!isDatabaseConfigured || !supabase) {
      setError("The database isn't connected yet.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/guest/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          agreedTerms: agreeTerms,
        }),
      });
      const resBody = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(resBody.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resBody.email,
        password: resBody.password,
      });

      if (signInError) {
        setError(
          "Your account was started, but we couldn't sign you in automatically. Please try again."
        );
        setSubmitting(false);
        return;
      }

      // Best-effort, not blocking: lets the patient come back later (or
      // set a real password to keep this account for good) via the
      // site's existing forgot-password flow. If this fails for some
      // reason they're still signed in and can book right now either
      // way.
      void supabase.auth.resetPasswordForEmail(resBody.email, {
        redirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
      });

      // No further action needed here — the sign-in above updates the
      // session, and /book re-renders past the "not logged in" screen
      // on its own.
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800 transition hover:border-teal-300"
      >
        Don&rsquo;t want to register? Continue as a guest
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-4 space-y-4 rounded-lg border border-teal-200 bg-teal-50 p-4"
    >
      <p className="text-xs text-ink-600">
        Just enough to book and keep a record of your consultation — no password needed right now.
      </p>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
      )}
      <FormField label="Full name" name="guestFullName" value={fullName} onChange={setFullName} required />
      <FormField
        label="Email"
        name="guestEmail"
        type="email"
        value={email}
        onChange={setEmail}
        required
      />
      <FormField label="Phone (optional)" name="guestPhone" type="tel" value={phone} onChange={setPhone} />
      <label className="flex items-start gap-2.5 text-xs text-ink-600">
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-medium text-teal-700 underline underline-offset-2">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-teal-700 underline underline-offset-2">
            Privacy Policy
          </Link>
          , including the{" "}
          <Link href="/refund-policy" className="font-medium text-teal-700 underline underline-offset-2">
            Refund &amp; Cancellation Policy
          </Link>
          .
        </span>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:opacity-60"
      >
        {submitting ? "Starting…" : "Continue to booking"}
      </button>
    </form>
  );
}
