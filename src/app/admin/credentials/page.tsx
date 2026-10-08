"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/monitoredFetch";
import { credentialOption, STATUS_LABEL, type DoctorCredentialRow } from "@/lib/credentials";

// Admin → Credentials (2026-10-08). Doctors request MBBS / RMP / MCPS /
// FCPS etc.; nothing is shown to patients until it is approved here.
//  * MBBS / BDS / RMP: check against the doctor's PMDC certificate
//    ("View PMDC certificate"), then Approve.
//  * Postgraduate (MCPS, FCPS, ...): open the evidence the doctor
//    uploaded (CPSP certificate or PMDC registration showing the
//    qualification), check it, then Approve — or Reject with a reason.
//  * An approved credential can be Removed at any time; it disappears
//    from every public page immediately and the record is kept.

interface Row extends DoctorCredentialRow {
  doctor: { full_name: string; pmdc_number: string | null } | null;
}

export default function AdminCredentials() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase
      .from("doctor_credentials")
      .select(
        "id, doctor_id, credential, detail, status, evidence_path, rejection_reason, requested_at, reviewed_at, doctor:doctor_profiles(full_name, pmdc_number)"
      )
      .order("requested_at", { ascending: false })
      .limit(300);
    if (e) {
      setError(/doctor_credentials/.test(e.message) ? "The credentials table isn't set up yet — run migration 0067 in Supabase first." : e.message);
      return;
    }
    setError(null);
    setRows(
      (data ?? []).map((r) => {
        const d = (r as { doctor: unknown }).doctor;
        return { ...(r as object), doctor: Array.isArray(d) ? (d[0] ?? null) : d } as Row;
      })
    );
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function token() {
    const {
      data: { session },
    } = await supabase!.auth.getSession();
    return session?.access_token ?? "";
  }

  async function openFile(url: string, failMsg: string) {
    if (!supabase) return;
    setError(null);
    const { res, data } = await safeJson(url, { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) {
      setError(data.error ?? failMsg);
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function review(id: string, patch: Record<string, unknown>) {
    if (!supabase) return;
    setBusy(id);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e } = await supabase
      .from("doctor_credentials")
      .update({ ...patch, reviewed_at: new Date().toISOString(), reviewed_by: user?.id ?? null })
      .eq("id", id);
    setBusy(null);
    setRejectingId(null);
    setReason("");
    if (e) {
      setError(e.message);
      return;
    }
    await load();
  }

  const pending = (rows ?? []).filter((r) => r.status === "pending_review");
  const approved = (rows ?? []).filter((r) => r.status === "approved");
  const history = (rows ?? []).filter((r) => r.status === "rejected" || r.status === "removed").slice(0, 30);

  const label = (r: Row) => `${r.credential}${r.detail ? ` (${r.detail})` : ""}`;

  return (
    <AdminGuard title="Credentials">
      {() => (
        <div>
          <PageHeader
            title="Doctor credentials"
            subtitle="Approve the qualifications doctors ask to show next to their name. Only approved ones are public."
          />
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>
            {error && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}

            {rows && (
              <>
                <section>
                  <h2 className="text-sm font-bold text-slate-900">Waiting for review ({pending.length})</h2>
                  {pending.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No requests waiting.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {pending.map((r) => {
                        const needsEvidence = credentialOption(r.credential)?.needsEvidence ?? false;
                        return (
                          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {r.doctor?.full_name ?? "Doctor"} <span className="text-slate-400">asks for</span> {label(r)}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  PMDC no. {r.doctor?.pmdc_number ?? "—"} · requested{" "}
                                  {new Date(r.requested_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </div>
                              </div>
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                {needsEvidence ? "Check the uploaded proof" : "Check against PMDC certificate"}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                              {r.evidence_path && (
                                <button
                                  onClick={() => openFile(`/api/admin/credentials/${r.id}/evidence`, "Couldn't open the proof.")}
                                  className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700"
                                >
                                  View uploaded proof
                                </button>
                              )}
                              <button
                                onClick={() => openFile(`/api/admin/doctors/${r.doctor_id}/certificate`, "Couldn't open the PMDC certificate.")}
                                className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700"
                              >
                                View PMDC certificate
                              </button>
                              <button
                                disabled={busy === r.id}
                                onClick={() => review(r.id, { status: "approved", rejection_reason: null })}
                                className="rounded-full bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => setRejectingId(rejectingId === r.id ? null : r.id)}
                                className="rounded-full border border-red-200 px-3 py-1.5 font-semibold text-red-700"
                              >
                                Reject
                              </button>
                            </div>
                            {rejectingId === r.id && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <input
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="Reason shown to the doctor (e.g. certificate unreadable)"
                                  className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                                />
                                <button
                                  disabled={busy === r.id}
                                  onClick={() => review(r.id, { status: "rejected", rejection_reason: reason.trim() || null })}
                                  className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                >
                                  Confirm reject
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section>
                  <h2 className="text-sm font-bold text-slate-900">Approved and public ({approved.length})</h2>
                  {approved.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">None yet.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Doctor</th>
                            <th className="px-3 py-2 font-semibold">Credential</th>
                            <th className="px-3 py-2 font-semibold">Approved</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {approved.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2">{r.doctor?.full_name ?? "—"}</td>
                              <td className="px-3 py-2 font-semibold">{label(r)}</td>
                              <td className="px-3 py-2 text-slate-500">
                                {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.evidence_path && (
                                  <button
                                    onClick={() => openFile(`/api/admin/credentials/${r.id}/evidence`, "Couldn't open the proof.")}
                                    className="mr-3 font-semibold text-teal-700 underline underline-offset-2"
                                  >
                                    Proof
                                  </button>
                                )}
                                <button
                                  disabled={busy === r.id}
                                  onClick={() => {
                                    if (window.confirm(`Remove ${label(r)} from ${r.doctor?.full_name ?? "this doctor"}? It will disappear from all public pages.`))
                                      review(r.id, { status: "removed" });
                                  }}
                                  className="font-semibold text-red-700 underline underline-offset-2 disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {history.length > 0 && (
                  <section>
                    <h2 className="text-sm font-bold text-slate-900">Recently rejected or removed</h2>
                    <ul className="mt-3 space-y-1 text-xs text-slate-600">
                      {history.map((r) => (
                        <li key={r.id}>
                          {r.doctor?.full_name ?? "Doctor"} — {label(r)} —{" "}
                          <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_LABEL[r.status].tone}`}>{STATUS_LABEL[r.status].text}</span>
                          {r.rejection_reason ? ` — ${r.rejection_reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
