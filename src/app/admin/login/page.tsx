"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// A deliberately separate front door from both the patient and doctor
// logins — same Supabase Auth underneath, same "check membership after
// signing in, turn away anyone who isn't" pattern as /doctor/login.

type Errors = Partial<Record<"email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminLogin() {
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
      .from("admin_profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    setSubmitting(false);

    if (profileError) {
      setServerError(profileError.message);
      return;
    }
    if (!profile) {
      // Correct credentials, but not an admin account — don't leave them
      // signed in on the wrong side of the platform.
      await supabase.auth.signOut();
      setServerError(
        "This login is for admin accounts only. If you're a patient or doctor, use the regular log-in page instead."
      );
      return;
    }

    router.push("/admin");
  }

  return (
    <div>
      <PageHeader title="Admin Log In" subtitle="Staff access only." />
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
        </form>
      </div>
    </div>
  );
}
