"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// A deliberately separate front door from the patient /login page (Phase
// 7 scoping decision, 2026-09-11) — same Supabase Auth underneath, but
// never shown alongside or linked from the patient-facing login/nav.
// After signing in, this checks the account against `doctor_profiles`
// (0015) before letting anyone into /doctor — a patient's own working
// credentials will authenticate fine here (it's the same auth system)
// but will be turned away with a clear message rather than silently
// landing on an empty or wrong dashboard.

type Errors = Partial<Record<"email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DoctorLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): Errors {
    const next: Errors = {};
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email address.";
    }
    if (password.length === 0) {
      next.password = "Please enter your password.";
    }
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!isDatabaseConfigured || !supabase) {
      setNotConfigured(true);
      return;
    }

    setSubmitting(true);
    setServerError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setSubmitting(false);
      setServerError(error.message);
      return;
    }

    const userId = data.user?.id;
    const { data: profile, error: profileError } = await supabase
      .from("doctor_profiles")
      .select("id, verification_status, is_active, rejection_reason")
      .eq("id", userId)
      .maybeSingle();

    setSubmitting(false);

    if (profileError) {
      setServerError(profileError.message);
      return;
    }
    if (!profile) {
      // Correct credentials, but not a doctor account — don't leave
      // them signed in on the wrong side of the platform.
      await supabase.auth.signOut();
      setServerError(
        "This login is for doctor accounts only. If you're a patient, use the regular log-in page instead."
      );
      return;
    }

    // Doctor onboarding, step 1: a doctor_profiles row can now exist
    // for a self-registered applicant who isn't approved yet, or was
    // rejected, or was deactivated by admin — none of those should
    // land on the dashboard, so this checks status before routing in,
    // same as the "not a doctor account" case above.
    if (profile.verification_status === "pending_review") {
      await supabase.auth.signOut();
      setServerError(
        "Your application is still under review. We'll be in touch once your PMDC certificate has been checked."
      );
      return;
    }
    if (profile.verification_status === "rejected") {
      await supabase.auth.signOut();
      setServerError(
        profile.rejection_reason
          ? `Your application wasn't approved: ${profile.rejection_reason}`
          : "Your application wasn't approved. Please contact us if you have questions."
      );
      return;
    }
    if (!profile.is_active) {
      await supabase.auth.signOut();
      setServerError("Your account has been deactivated. Please contact the platform administrator.");
      return;
    }

    router.push("/doctor");
  }

  return (
    <div>
      <PageHeader title="Doctor Log In" subtitle="Staff access only." />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {notConfigured && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">The database isn&rsquo;t connected yet.</p>
            <p className="mt-1 leading-relaxed">
              This form is fully built and validated, but logging in needs
              a Supabase project connected first.
            </p>
          </div>
        )}
        {serverError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Couldn&rsquo;t log you in.</p>
            <p className="mt-1 leading-relaxed">{serverError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-800 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:opacity-60"
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>

          <p className="text-center text-sm text-slate-500">
            <Link href="/forgot-password" className="font-medium text-teal-700 underline underline-offset-2">
              Forgot your password?
            </Link>
          </p>

          <p className="text-center text-sm text-slate-500">
            New doctor?{" "}
            <Link href="/doctor/register" className="font-medium text-teal-700 underline underline-offset-2">
              Apply to join
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
