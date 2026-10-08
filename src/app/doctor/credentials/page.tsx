"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { prepareUpload } from "@/lib/compressImage";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { CREDENTIALS, credentialOption, STATUS_LABEL, type DoctorCredentialRow } from "@/lib/credentials";

// My credentials (2026-10-08). A doctor asks for MBBS / BDS / RMP /
// MCPS / FCPS ... to be shown next to their name. MBBS/BDS/RMP are
// checked by the admin against the PMDC certificate already on file;
// postgraduate qualifications need proof uploaded here (the certificate
// awarded by CPSP, or a PMDC registration showing the updated
// qualification). Nothing is public until an admin approves it.

export default function DoctorCredentials() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } = useDoctorProfileWithSignOut();

  const [rows, setRows] = useState<DoctorCredentialRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [detail, setDetail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !profile) return;
    const { data, error } = await supabase
      .from("doctor_credentials")
      .select("id, doctor_id, credential, detail, status, evidence_path, rejection_reason, requested_at, reviewed_at")
      .eq("doctor_id", profile.id)
      .order("requested_at", { ascending: false });
    if (error) {
      setLoadError(
        /doctor_credentials/.test(error.message) ? "Credentials aren't switched on yet. Please try again later." : error.message
      );
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows(data as DoctorCredentialRow[]);
  }, [profile]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const option = credentialOption(code);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSubmitError(null);
    setSubmitted(false);
    if (!option) {
      setSubmitError("Please choose a credential.");
      return;
    }
    if (option.needsEvidence && !file) {
      setSubmitError(`${option.code} needs proof — please attach your certificate.`);
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("credential", option.code);
      form.set("detail", detail.trim());
      if (file) {
        const p = await prepareUpload(file);
        if (!p.file) {
          setSubmitError(p.error ?? "Please choose a different file.");
          return;
        }
        form.set("evidence", p.file);
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const result = await apiFetch(
        "/api/doctors/credentials",
        { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, body: form },
        { timeoutMs: 90_000 }
      );
      if (!result.ok) {
        setSubmitError(result.error ?? "Couldn't send your request.");
        return;
      }
    } catch {
      setSubmitError("Something went wrong. Please try again in a minute.");
      return;
    } finally {
      setSubmitting(false);
    }
    setSubmitted(true);
    setCode("");
    setDetail("");
    setFile(null);
    await load();
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="profile">
        <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking) {
    return (
      <DoctorShell active="profile">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!session) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
          <p>Please log in with your doctor account first.</p>
          <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
            Doctor log in
          </Link>
        </div>
      </DoctorShell>
    );
  }
  if (profileError) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <div className="mt-4 flex gap-4">
            <button onClick={() => signOut()} className="font-semibold text-teal-700 underline underline-offset-2">
              Log out
            </button>
            <Link href="/doctor/login" className="font-semibold text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </DoctorShell>
    );
  }

  return (
    <DoctorShell active="profile" doctorName={profile.full_name} onSignOut={signOut}>
      <div className="mx-auto max-w-2xl">
        <Link href="/doctor/profile" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← My Profile
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">My credentials</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Ask for your qualifications to be shown under your name. MBBS, BDS and RMP are checked against the PMDC certificate you
          already submitted. For MCPS, FCPS and other postgraduate qualifications, attach your certificate from CPSP (or the awarding
          body), or your PMDC registration showing the updated qualification. Patients only see a credential after it is approved.
        </p>

        {loadError && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</p>}

        <div className="mt-6 space-y-2">
          {(rows ?? []).filter((r) => r.status !== "removed").length === 0 && rows !== undefined && !loadError && (
            <p className="text-sm text-ink-500">You haven&rsquo;t requested any credentials yet.</p>
          )}
          {(rows ?? [])
            .filter((r) => r.status !== "removed")
            .map((r) => (
              <div key={r.id} className="rounded-2xl border border-ink-border bg-white p-4 text-sm shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink-900">
                    {r.credential}
                    {r.detail ? ` (${r.detail})` : ""}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_LABEL[r.status].tone}`}>
                    {STATUS_LABEL[r.status].text}
                  </span>
                </div>
                {r.status === "rejected" && r.rejection_reason && (
                  <p className="mt-2 text-xs font-semibold text-red-700">Reason: {r.rejection_reason}</p>
                )}
              </div>
            ))}
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-ink-border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-ink-900">Request a credential</h2>

          <div>
            <label className="block text-sm font-medium text-ink-900" htmlFor="cred">
              Credential
            </label>
            <select
              id="cred"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setFile(null);
              }}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {CREDENTIALS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            {option && <p className="mt-1.5 text-xs text-ink-500">{option.hint}</p>}
          </div>

          {option?.needsEvidence && (
            <>
              <div>
                <label className="block text-sm font-medium text-ink-900" htmlFor="detail">
                  Subject (optional)
                </label>
                <input
                  id="detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  maxLength={40}
                  placeholder="e.g. Paediatrics"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-900" htmlFor="evidence">
                  Proof (required)
                </label>
                <input
                  id="evidence"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm"
                />
                <p className="mt-1 text-xs text-ink-500">JPG, PNG or PDF. Photos are shrunk automatically; a PDF must be under 4 MB.</p>
              </div>
            </>
          )}

          {submitError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{submitError}</p>}
          {submitted && (
            <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              Request sent. An admin will review it — you&rsquo;ll see the result in the list above.
            </p>
          )}
          {submitting && option?.needsEvidence && <p className="text-xs text-ink-500">Uploading your proof… this can take a little on a slow connection.</p>}

          <button
            type="submit"
            disabled={submitting || !code}
            className="rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Send request"}
          </button>
        </form>
      </div>
    </DoctorShell>
  );
}
