"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Fix from the 2026-09-16 technical audit follow-up: until now there was
// no password-reset path anywhere in the product, for any of the three
// account types (patient, doctor, admin) — a locked-out user's only
// option was contacting the physician directly. This is one shared page
// because all three account types sit in the same underlying Supabase
// Auth system — the doctor and admin login pages link here too.
//
// Zero additional cost: this is Supabase Auth's own built-in
// resetPasswordForEmail flow, already part of the project, not a new
// service.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!isDatabaseConfigured || !supabase) {
      setNotConfigured(true);
      return;
    }

    setSubmitting(true);
    setServerError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
    });
    setSubmitting(false);

    if (resetError) {
      // Deliberately still shown (rather than always saying "check your
      // email" regardless) since this product doesn't currently need to
      // hide which emails have accounts — matches the plain, direct error
      // style already used on every login page here.
      setServerError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div>
      <PageHeader title="Reset your password" />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {notConfigured && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">The database isn&rsquo;t connected yet.</p>
            <p className="mt-1 leading-relaxed">
              This form is fully built and validated, but sending a reset
              email needs a Supabase project connected first.
            </p>
          </div>
        )}
        {serverError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Couldn&rsquo;t send the reset email.</p>
            <p className="mt-1 leading-relaxed">{serverError}</p>
          </div>
        )}

        {sent ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            <p className="font-semibold">Check your email.</p>
            <p className="mt-1 leading-relaxed">
              If an account exists for {email.trim()}, a password reset link
              has been sent. Open it to choose a new password.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <p className="text-sm text-slate-500">
              Enter the email address on your account — patient, doctor or
              admin — and we&rsquo;ll send you a link to set a new password.
            </p>
            <FormField
              label="Email"
              name="email"
              type="email"
              value={email}
              onChange={setEmail}
              error={error ?? undefined}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
