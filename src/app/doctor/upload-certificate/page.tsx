"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import CertificateUploader from "@/components/CertificateUploader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Finish a doctor application whose PMDC certificate didn't upload
// (2026-10-08). The doctor signs in with the email and password they
// applied with, uploads the certificate (progress + retry), and is signed
// out again — applicants still can't use the doctor area until approved.

export default function UploadCertificate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [done, setDone] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err || !data.user) {
        setError("That email and password don't match an application. Please check them and try again.");
        return;
      }
      const { data: row } = await supabase.from("doctor_profiles").select("id").eq("id", data.user.id).maybeSingle();
      if (!row) {
        await supabase.auth.signOut();
        setError("We couldn't find a doctor application for this account.");
        return;
      }
      setSignedIn(true);
    } catch {
      setError("Couldn't reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function token() {
    const {
      data: { session },
    } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return session?.access_token ?? "";
  }

  async function finished() {
    await supabase?.auth.signOut();
    setSignedIn(false);
    setDone(true);
  }

  return (
    <div>
      <PageHeader title="Upload your PMDC certificate" subtitle="For doctors whose application is saved but whose certificate didn't upload." />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {!isDatabaseConfigured && <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>}
        {done ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-semibold">Certificate received.</p>
            <p className="mt-2 leading-relaxed">We&rsquo;ll review it and get back to you.</p>
            <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-800 underline underline-offset-2">
              Go to doctor log in
            </Link>
          </div>
        ) : signedIn ? (
          <div className="rounded-3xl border border-[#d7e7e2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
            <CertificateUploader getToken={token} onDone={finished} />
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-5" noValidate>
            <FormField label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            <FormField label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
