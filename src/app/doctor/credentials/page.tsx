"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { prepareUpload } from "@/lib/compressImage";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import {
  CREDENTIALS,
  STATUS_LABEL,
  OTHER_NAME_MAX,
  DETAIL_MAX,
  checkOtherName,
  type DoctorCredentialRow,
} from "@/lib/credentials";

// My credentials (2026-10-08). A doctor asks for MBBS / BDS / RMP /
// MCPS / FCPS ... to be shown next to their name. MBBS/BDS/RMP are
// checked by the admin against the PMDC certificate already on file;
// postgraduate qualifications need proof uploaded here (the certificate
// awarded by CPSP, or a PMDC registration showing the updated
// qualification). Nothing is public until an admin approves it.
//
// 2026-10-11: one request can now carry SEVERAL credentials (tick as many
// as apply), and an "Other" option lets a doctor type a qualification that
// is not in the list (e.g. CHPE). "Other" always needs proof and, like every
// credential, is public only after an admin approves it.

export default function DoctorCredentials() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } = useDoctorProfileWithSignOut();

  const [rows, setRows] = useState<DoctorCredentialRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [otherOn, setOtherOn] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [otherDetail, setOtherDetail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

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

  const chosen = CREDENTIALS.filter((c) => picked[c.code]);
  const anyNeedsProof = chosen.some((c) => c.needsEvidence) || otherOn;
  const nothingChosen = chosen.length === 0 && !otherOn;

  // MBBS / BDS / RMP can only be requested once; postgraduate ones can be
  // requested again for another subject (e.g. FCPS in two subjects).
  const alreadyHave = new Set(
    (rows ?? [])
      .filter((r) => r.status === "pending_review" || r.status === "approved")
      .filter((r) => !CREDENTIALS.find((c) => c.code === r.credential)?.needsEvidence)
      .map((r) => r.credential)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSubmitError(null);
    setSubmitted(false);
    setSentNote(null);
    if (nothingChosen) {
      setSubmitError("Please tick at least one credential.");
      return;
    }
    let otherClean = "";
    if (otherOn) {
      const checked = checkOtherName(otherName);
      if (checked.name === null) {
        setSubmitError(checked.error);
        return;
      }
      otherClean = checked.name;
    }
    if (anyNeedsProof && !file) {
      setSubmitError("Please attach your proof — the certificate for each qualification that needs it.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set(
        "items",
        JSON.stringify(chosen.map((c) => ({ code: c.code, detail: c.needsEvidence ? (subjects[c.code] ?? "").trim() : "" })))
      );
      if (otherOn) {
        form.set("other_name", otherClean);
        form.set("other_detail", otherDetail.trim());
      }
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
      const result = await apiFetch<{ created?: number; skipped?: string[] }>(
        "/api/doctors/credentials",
        { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, body: form },
        { timeoutMs: 90_000 }
      );
      if (!result.ok) {
        setSubmitError(result.error ?? "Couldn't send your request.");
        return;
      }
      const skipped = result.data?.skipped ?? [];
      if (skipped.length > 0) setSentNote(`Already on your list, so not sent again: ${skipped.join(", ")}.`);
    } catch {
      setSubmitError("Something went wrong. Please try again in a minute.");
      return;
    } finally {
      setSubmitting(false);
    }
    setSubmitted(true);
    setPicked({});
    setSubjects({});
    setOtherOn(false);
    setOtherName("");
    setOtherDetail("");
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
        <div className="mx-auto max-w-md rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
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
          body), or your PMDC registration showing the updated qualification. Tick as many as apply and send them in one request. If yours isn&rsquo;t listed, choose &ldquo;Other&rdquo; and type it (for example CHPE) with your certificate. Patients only see a credential after it is approved.
        </p>

        {loadError && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</p>}

        <div className="mt-6 space-y-2">
          {(rows ?? []).filter((r) => r.status !== "removed").length === 0 && rows !== undefined && !loadError && (
            <p className="text-sm text-ink-500">You haven&rsquo;t requested any credentials yet.</p>
          )}
          {(rows ?? [])
            .filter((r) => r.status !== "removed")
            .map((r) => (
              <div key={r.id} className="rounded-2xl border border-[#dcebe6] bg-white p-4 text-sm shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
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

        <form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl border border-[#dcebe6] bg-white p-6 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <div>
            <h2 className="text-sm font-bold text-ink-900">Request credentials</h2>
            <p className="mt-1 text-xs text-ink-500">Tick everything you would like shown — you can send them all in one request.</p>
          </div>

          <fieldset>
            <legend className="text-xs font-bold uppercase tracking-wider text-teal-700">Checked against your PMDC certificate</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CREDENTIALS.filter((c) => !c.needsEvidence).map((c) => {
                const have = alreadyHave.has(c.code);
                return (
                  <label
                    key={c.code}
                    className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-sm ${
                      have ? "border-[#e3efeb] bg-[#f7fbf9] text-ink-500" : "cursor-pointer border-[#d7e7e2] hover:border-teal-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={have}
                      checked={!!picked[c.code]}
                      onChange={(e) => setPicked((prev) => ({ ...prev, [c.code]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-[#bcd5ce] text-teal-700 focus:ring-teal-500"
                    />
                    <span className="font-semibold text-ink-900">
                      {c.label}
                      {have && <span className="ml-2 text-[11px] font-bold text-teal-700">already requested</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-bold uppercase tracking-wider text-teal-700">Postgraduate — proof needed</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CREDENTIALS.filter((c) => c.needsEvidence).map((c) => (
                <div key={c.code} className={`rounded-2xl border px-3.5 py-3 text-sm ${picked[c.code] ? "border-teal-600 bg-[#f1f8f5]" : "border-[#d7e7e2]"}`}>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={!!picked[c.code]}
                      onChange={(e) => setPicked((prev) => ({ ...prev, [c.code]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-[#bcd5ce] text-teal-700 focus:ring-teal-500"
                    />
                    <span className="font-semibold text-ink-900">{c.label}</span>
                  </label>
                  {picked[c.code] && (
                    <input
                      value={subjects[c.code] ?? ""}
                      onChange={(e) => setSubjects((prev) => ({ ...prev, [c.code]: e.target.value }))}
                      maxLength={DETAIL_MAX}
                      placeholder="Subject (optional), e.g. Paediatrics"
                      aria-label={`${c.code} subject`}
                      className="mt-2 w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-1.5 text-xs"
                    />
                  )}
                </div>
              ))}

              <div className={`rounded-2xl border px-3.5 py-3 text-sm sm:col-span-2 ${otherOn ? "border-teal-600 bg-[#f1f8f5]" : "border-[#d7e7e2]"}`}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={otherOn}
                    onChange={(e) => setOtherOn(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#bcd5ce] text-teal-700 focus:ring-teal-500"
                  />
                  <span>
                    <span className="font-semibold text-ink-900">Other</span>
                    <span className="ml-2 text-xs text-ink-500">a qualification that is not listed (for example CHPE)</span>
                  </span>
                </label>
                {otherOn && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor="other-name" className="block text-xs font-medium text-ink-900">
                        Qualification (short name)
                      </label>
                      <input
                        id="other-name"
                        value={otherName}
                        onChange={(e) => setOtherName(e.target.value)}
                        maxLength={OTHER_NAME_MAX}
                        placeholder="e.g. CHPE"
                        className="mt-1 w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="other-detail" className="block text-xs font-medium text-ink-900">
                        Awarded by (optional)
                      </label>
                      <input
                        id="other-detail"
                        value={otherDetail}
                        onChange={(e) => setOtherDetail(e.target.value)}
                        maxLength={DETAIL_MAX}
                        placeholder="e.g. Health Services Academy"
                        className="mt-1 w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <p className="text-xs text-ink-500 sm:col-span-2">
                      Proof is always needed for this one, and it appears to patients only after an admin approves it.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </fieldset>

          {anyNeedsProof && (
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
              <p className="mt-1 text-xs text-ink-500">
                One file for this request — your certificate, or your PMDC registration showing the qualifications. If your proofs are
                separate documents, send them as separate requests. JPG, PNG or PDF; photos are shrunk automatically, a PDF must be under 4 MB.
              </p>
            </div>
          )}

          {submitError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{submitError}</p>}
          {submitted && (
            <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              Request sent. An admin will review it — you&rsquo;ll see the result in the list above.
              {sentNote && <span className="mt-1 block text-xs">{sentNote}</span>}
            </p>
          )}
          {submitting && anyNeedsProof && <p className="text-xs text-ink-500">Uploading your proof… this can take a little on a slow connection.</p>}

          <button
            type="submit"
            disabled={submitting || nothingChosen}
            className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Sending…" : chosen.length + (otherOn ? 1 : 0) > 1 ? "Send requests" : "Send request"}
          </button>
        </form>
      </div>
    </DoctorShell>
  );
}
