"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Second half of the password-reset flow (see /forgot-password). Supabase
// Auth's own client parses the recovery link's token from the URL and
// creates a temporary session automatically (detectSessionInUrl, on by
// default) — this page just waits for that session, then calls
// updateUser({ password }), the same built-in Auth API, no new service.
//
// One shared page for all three account types: after the password is
// set, it checks doctor_profiles / admin_profiles (same lookup the two
// staff login pages already do) purely to send the person to the right
// place next — the password itself works identically everywhere.

export default function ResetPassword() {
  const router = useRouter();
  const [checkingLink, setCheckingLink] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCheckingLink(false);
      return;
    }

    // detectSessionInUrl needs a moment to parse the link and fire this —
    // getSession() alone can run before that finishes, so both are
    // checked rather than just one.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasRecoverySession(true);
      setCheckingLink(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY" || newSession) {
        setHasRecoverySession(true);
        setCheckingLink(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("Passwords don't match.");
      return;
    }
    if (!supabase) return;

    setSubmitting(true);
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setServerError(error.message);
      return;
    }
    setDone(true);
  }

  function continueToAccount() {
    const client = supabase;
    if (!client) {
      router.push("/login");
      return;
    }
    client.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id;
      if (!userId) {
        router.push("/login");
        return;
      }
      const [{ data: doctorProfile }, { data: adminProfile }] = await Promise.all([
        client.from("doctor_profiles").select("id").eq("id", userId).maybeSingle(),
        client.from("admin_profiles").select("id").eq("id", userId).maybeSingle(),
      ]);
      if (adminProfile) router.push("/admin");
      else if (doctorProfile) router.push("/doctor");
      else router.push("/dashboard");
    });
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Set a new password" />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s no
            account system to reset a password for.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Set a new password" />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {checkingLink ? (
          <p className="text-sm text-slate-500">Checking your reset link…</p>
        ) : !hasRecoverySession ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">This reset link is invalid or has expired.</p>
            <p className="mt-2">
              <Link href="/forgot-password" className="font-medium text-teal-700 underline underline-offset-2">
                Request a new one
              </Link>
            </p>
          </div>
        ) : done ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            <p className="font-semibold">Your password has been updated.</p>
            <button
              onClick={continueToAccount}
              className="mt-4 w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              Continue
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {serverError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {serverError}
              </div>
            )}
            <FormField
              label="New password"
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint="At least 8 characters."
              required
            />
            <FormField
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              error={fieldError ?? undefined}
              autoComplete="new-password"
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
