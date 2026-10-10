"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { PATIENT_TERMS_VERSION } from "@/lib/patientTerms";

type Errors = Partial<Record<"fullName" | "email" | "phone" | "password" | "confirmPassword" | "agreeTerms", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,15}$/;

export default function Register() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [slowNote, setSlowNote] = useState(false);
  const [result, setResult] = useState<
    | { kind: "not-configured" }
    | { kind: "error"; message: string }
    | { kind: "success"; needsEmailConfirm: boolean }
    | null
  >(null);

  function validate(): Errors {
    const next: Errors = {};
    if (fullName.trim().length < 2) {
      next.fullName = "Please enter your full name.";
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email address.";
    }
    if (phone.trim() && !PHONE_RE.test(phone.trim())) {
      next.phone = "Please enter a valid phone number, or leave this blank.";
    }
    if (password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    }
    if (confirmPassword !== password) {
      next.confirmPassword = "Passwords don't match.";
    }
    if (!agreeTerms) {
      next.agreeTerms = "Please agree to the Terms and Privacy Policy to continue.";
    }
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!isDatabaseConfigured || !supabase) {
      setResult({ kind: "not-configured" });
      return;
    }

    setSubmitting(true);
    setSlowNote(false);
    // Site-health (2026-10-07): sign-up can sit waiting on the email
    // provider. Never leave the button stuck: say it is still working after
    // 8 seconds, and always end with a clear message (the browser's
    // Supabase calls give up after 30 seconds).
    const slowTimer = setTimeout(() => setSlowNote(true), 8000);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            // Picked up by the record_patient_terms_acceptance() trigger
            // (migration 0057) and written to patient_agreement_acceptances
            // the moment this account is created — including when email
            // confirmation is required and there's no session yet to make
            // a follow-up client-side call with.
            terms_version: PATIENT_TERMS_VERSION,
          },
        },
      });

      if (error) {
        const msg = error.message || "";
        const slowOrOffline = /fetch|network|timed? ?out|timeout|retryable/i.test(msg) || (error as { status?: number }).status === 0;
        setResult({
          kind: "error",
          message: slowOrOffline
            ? "This is taking longer than expected, so we stopped waiting. Your account may have been created — check your email, or try logging in. If not, please try again."
            : /rate limit/i.test(msg)
              ? "Too many sign-up attempts right now. Please wait a few minutes and try again."
              : msg,
        });
        return;
      }

      // Supabase returns a user with no session when email confirmation is
      // required before the account is usable.
      const needsEmailConfirm = !!data.user && !data.session;
      if (!needsEmailConfirm && data.session) {
        // Already signed in (email confirmation is off, e.g. during
        // synthetic testing) - go straight to the dashboard instead of
        // making them log in again right after registering.
        router.push("/dashboard");
        return;
      }
      setResult({ kind: "success", needsEmailConfirm });
    } catch {
      setResult({
        kind: "error",
        message:
          "Couldn't reach the server. Please check your internet connection and try again. If you already received a confirmation email, just log in.",
      });
    } finally {
      clearTimeout(slowTimer);
      setSubmitting(false);
      setSlowNote(false);
    }
  }

  if (result?.kind === "success") {
    return (
      <div>
        <PageHeader title="Create your account" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-semibold">Account created, {fullName.split(" ")[0]}.</p>
            <p className="mt-2 leading-relaxed">
              {result.needsEmailConfirm
                ? "Check your email to confirm your address before logging in."
                : "You can now log in with your email and password."}
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm font-semibold text-teal-800 underline underline-offset-2"
            >
              Go to log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Create your account"
        subtitle="Just enough information to create your account."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {result?.kind === "not-configured" && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">The database isn&rsquo;t connected yet.</p>
            <p className="mt-1 leading-relaxed">
              This form is fully built and validated, but real account
              creation needs a Supabase project connected first. Nothing
              you entered was saved.
            </p>
          </div>
        )}
        {result?.kind === "error" && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Couldn&rsquo;t create your account.</p>
            <p className="mt-1 leading-relaxed">{result.message}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-8">
          <FormField
            label="Full name"
            name="fullName"
            value={fullName}
            onChange={setFullName}
            error={errors.fullName}
            placeholder="e.g. Ahmed Khan"
            autoComplete="name"
            required
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            error={errors.email}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <FormField
            label="Phone number"
            name="phone"
            type="tel"
            value={phone}
            onChange={setPhone}
            error={errors.phone}
            placeholder="+92 3XX XXXXXXX"
            autoComplete="tel"
            hint="Optional for now — used later for appointment reminders."
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            autoComplete="new-password"
            hint="At least 8 characters."
            required
          />
          <FormField
            label="Confirm password"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={errors.confirmPassword}
            autoComplete="new-password"
            required
          />

          <div>
            <label className="flex items-start gap-2.5 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700 focus:ring-teal-500"
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
                .
              </span>
            </label>
            {errors.agreeTerms && (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.agreeTerms}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
          {submitting && slowNote && (
            <p className="text-center text-xs text-ink-500">
              Still working — your connection looks slow. Please don&rsquo;t close this page.
            </p>
          )}

          <p className="text-center text-sm text-ink-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
