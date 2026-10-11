"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { prepareUpload } from "@/lib/compressImage";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { SPECIALTIES } from "@/lib/specialties";

// Change my specialty (2026-10-11). A doctor who registered under the wrong
// specialty — or has since been certified in a different one — can ask ONCE
// to change it. An admin reviews the request (Admin → Specialty changes);
// the specialty on the public profile changes only when it is approved. A
// request that is not approved does not use up the one change.
// Lives under /doctor/profile/ so it is covered by the same "doctor workspace,
// not tracked as a public page" rule as the profile page.

interface ChangeRow {
  id: string;
  from_specialty: string | null;
  to_specialty: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
}

const STATUS: Record<ChangeRow["status"], { text: string; tone: string }> = {
  pending: { text: "Waiting for review", tone: "bg-amber-100 text-amber-800" },
  approved: { text: "Approved — now live", tone: "bg-teal-100 text-teal-800" },
  rejected: { text: "Not approved", tone: "bg-red-100 text-red-800" },
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function DoctorSpecialtyChange() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } = useDoctorProfileWithSignOut();

  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState<ChangeRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [specialty, setSpecialty] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !profile) return;
    const spec = await supabase.from("doctor_profiles").select("specialty").eq("id", profile.id).maybeSingle();
    setCurrent(((spec.data as { specialty: string | null } | null)?.specialty) ?? null);
    const { data, error } = await supabase
      .from("doctor_specialty_changes")
      .select("id, from_specialty, to_specialty, reason, status, rejection_reason, requested_at, reviewed_at")
      .eq("doctor_id", profile.id)
      .order("requested_at", { ascending: false });
    if (error) {
      setLoadError(
        /doctor_specialty_changes/.test(error.message) ? "Specialty changes aren't switched on yet. Please try again later." : error.message
      );
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows(data as ChangeRow[]);
  }, [profile]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const used = (rows ?? []).some((r) => r.status === "approved");
  const waiting = (rows ?? []).some((r) => r.status === "pending");
  const lastRejected = (rows ?? []).find((r) => r.status === "rejected");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSubmitError(null);
    setSubmitted(false);
    if (!specialty) {
      setSubmitError("Please choose the specialty you want to change to.");
      return;
    }
    if (reason.trim().length < 10) {
      setSubmitError("Please briefly explain the change (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("specialty", specialty);
      form.set("reason", reason.trim());
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
        "/api/doctors/specialty-change",
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
    setSpecialty("");
    setReason("");
    setFile(null);
    await load();
  }

  const shellProps = { active: "profile" as const };

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell {...shellProps}>
        <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking) {
    return (
      <DoctorShell {...shellProps}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!session) {
    return (
      <DoctorShell {...shellProps}>
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
      <DoctorShell {...shellProps}>
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell {...shellProps}>
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <button onClick={() => signOut()} className="mt-4 font-semibold text-teal-700 underline underline-offset-2">
            Log out
          </button>
        </div>
      </DoctorShell>
    );
  }

  return (
    <DoctorShell {...shellProps} doctorName={profile.full_name} onSignOut={signOut} doctorId={profile.id}>
      <div className="mx-auto max-w-2xl">
        <Link href="/doctor/profile" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← My Profile
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">Change my specialty</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Registered under the wrong specialty, or recently certified in a different one? You can ask for it to be changed{" "}
          <span className="font-semibold text-ink-700">once</span>. An admin reviews the request, and your public profile changes only
          after it is approved. If a request isn&rsquo;t approved, your one change is not used up.
        </p>

        <div className="mt-5 rounded-2xl border border-[#dcebe6] bg-white p-4 text-sm shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <span className="text-ink-500">Your specialty now: </span>
          <span className="font-semibold text-ink-900">{current === undefined ? "…" : (current ?? "Not set")}</span>
        </div>

        {loadError && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</p>}

        {(rows ?? []).length > 0 && (
          <div className="mt-5 space-y-2">
            {(rows ?? []).map((r) => (
              <div key={r.id} className="rounded-2xl border border-[#dcebe6] bg-white p-4 text-sm shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink-900">
                    {r.from_specialty ?? "—"} → {r.to_specialty}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">Requested {fmt(r.requested_at)}</p>
                {r.status === "rejected" && r.rejection_reason && (
                  <p className="mt-2 text-xs font-semibold text-red-700">Reason: {r.rejection_reason}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {used ? (
          <p className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            You have used your one specialty change. If something is still wrong, please contact the clinic team.
          </p>
        ) : waiting ? (
          <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Your request is waiting for an admin to review it. You&rsquo;ll see the result here.
          </p>
        ) : (
          rows !== undefined &&
          !loadError && (
            <form onSubmit={submit} className="mt-6 space-y-4 rounded-3xl border border-[#dcebe6] bg-white p-6 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
              <h2 className="text-sm font-bold text-ink-900">Request a change</h2>
              {lastRejected && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Your last request wasn&rsquo;t approved, so you can still make your one change.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-ink-900" htmlFor="new-specialty">
                  New specialty
                </label>
                <select
                  id="new-specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Choose…</option>
                  {SPECIALTIES.filter((s) => s !== current).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-900" htmlFor="why">
                  Why are you changing it?
                </label>
                <textarea
                  id="why"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. I registered under General Practice by mistake, or I completed my FCPS in this specialty in September."
                  className="mt-1 w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-900" htmlFor="proof">
                  Proof (optional, but it helps)
                </label>
                <input
                  id="proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm"
                />
                <p className="mt-1 text-xs text-ink-500">
                  For example your new certificate. JPG, PNG or PDF; photos are shrunk automatically, a PDF must be under 4 MB.
                </p>
              </div>

              {submitError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{submitError}</p>}
              {submitted && (
                <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
                  Request sent. An admin will review it — you&rsquo;ll see the result on this page.
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || !specialty}
                className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send request"}
              </button>
            </form>
          )
        )}
      </div>
    </DoctorShell>
  );
}
