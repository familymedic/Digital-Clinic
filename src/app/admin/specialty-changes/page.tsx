"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/monitoredFetch";

// Admin → Specialty changes (2026-10-11). A doctor may ask ONCE to change the
// specialty shown on their public profile (registered under the wrong one, or
// newly certified in another). Nothing changes until it is approved here:
//  * Read the reason, open the proof if there is one (e.g. a CPSP/FCPS
//    certificate), compare with the doctor's PMDC record if needed.
//  * Approve → the doctor's specialty changes immediately and that doctor
//    cannot ask again (the one change is used up).
//  * Reject → the doctor sees your reason and may send a new request; a
//    rejection does NOT use up the one change.
// Approve / Reject run through the database function review_specialty_change,
// which checks the caller is an admin and does both steps in one go.

interface Row {
  id: string;
  doctor_id: string;
  from_specialty: string | null;
  to_specialty: string;
  reason: string;
  evidence_path: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
  doctor: { full_name: string; pmdc_number: string | null } | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function AdminSpecialtyChanges() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase
      .from("doctor_specialty_changes")
      .select("id, doctor_id, from_specialty, to_specialty, reason, evidence_path, status, rejection_reason, requested_at, reviewed_at, doctor:doctor_profiles(full_name, pmdc_number)")
      .order("requested_at", { ascending: false })
      .limit(300);
    if (e) {
      setError(/doctor_specialty_changes/.test(e.message) ? "The specialty changes table isn't set up yet — run migration 0070 in Supabase first." : e.message);
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

  async function openFile(url: string, failMsg: string) {
    if (!supabase) return;
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { res, data } = await safeJson(url, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
    if (!res.ok) {
      setError(data.error ?? failMsg);
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function review(id: string, approve: boolean, why?: string) {
    if (!supabase) return;
    setBusy(id);
    setError(null);
    const { error: e } = await supabase.rpc("review_specialty_change", {
      p_request_id: id,
      p_approve: approve,
      p_reason: why ?? null,
    });
    setBusy(null);
    setRejectingId(null);
    setReason("");
    if (e) {
      setError(e.message);
      return;
    }
    await load();
  }

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const history = (rows ?? []).filter((r) => r.status !== "pending").slice(0, 50);

  return (
    <AdminGuard title="Specialty changes">
      {() => (
        <div>
          <PageHeader
            title="Specialty changes"
            subtitle="Doctors can ask once to change the specialty on their profile. It changes only when you approve."
          />
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>
            {error && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}

            {rows && (
              <>
                <section>
                  <h2 className="text-sm font-bold text-ink-900">Waiting for review ({pending.length})</h2>
                  {pending.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-500">No requests waiting.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {pending.map((r) => (
                        <div key={r.id} className="rounded-2xl border border-[#d7e7e2] bg-white p-4 text-sm shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
                          <div className="font-semibold text-ink-900">{r.doctor?.full_name ?? "Doctor"}</div>
                          <div className="mt-0.5 text-xs text-ink-500">
                            PMDC no. {r.doctor?.pmdc_number ?? "—"} · requested {fmt(r.requested_at)}
                          </div>
                          <div className="mt-3 rounded-xl bg-[#f1f8f5] p-3 text-sm">
                            <span className="text-ink-500">{r.from_specialty ?? "—"}</span> <span aria-hidden>→</span>{" "}
                            <span className="font-bold text-teal-800">{r.to_specialty}</span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-ink-700">
                            <span className="font-semibold text-ink-900">Doctor&rsquo;s reason: </span>
                            {r.reason}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            {r.evidence_path ? (
                              <button
                                onClick={() => openFile(`/api/admin/specialty-changes/${r.id}/evidence`, "Couldn't open the proof.")}
                                className="rounded-full border border-[#d7e7e2] px-3 py-1.5 font-semibold text-ink-700"
                              >
                                View uploaded proof
                              </button>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-800">No proof uploaded</span>
                            )}
                            <button
                              onClick={() => openFile(`/api/admin/doctors/${r.doctor_id}/certificate`, "Couldn't open the PMDC certificate.")}
                              className="rounded-full border border-[#d7e7e2] px-3 py-1.5 font-semibold text-ink-700"
                            >
                              View PMDC certificate
                            </button>
                            <button
                              disabled={busy === r.id}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Change ${r.doctor?.full_name ?? "this doctor"}'s specialty to ${r.to_specialty}? It goes live on their public profile now, and they cannot change it again.`
                                  )
                                )
                                  review(r.id, true);
                              }}
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
                                placeholder="Reason shown to the doctor (e.g. please upload your certificate)"
                                className="min-w-[16rem] flex-1 rounded-md border border-[#d7e7e2] px-3 py-1.5 text-xs"
                              />
                              <button
                                disabled={busy === r.id}
                                onClick={() => review(r.id, false, reason)}
                                className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                Confirm reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {history.length > 0 && (
                  <section>
                    <h2 className="text-sm font-bold text-ink-900">History</h2>
                    <div className="mt-3 overflow-x-auto rounded-lg border border-[#d7e7e2] bg-white">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-[#f1f8f5] text-ink-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Doctor</th>
                            <th className="px-3 py-2 font-semibold">Change</th>
                            <th className="px-3 py-2 font-semibold">Result</th>
                            <th className="px-3 py-2 font-semibold">Reviewed</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e3efeb]">
                          {history.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2">{r.doctor?.full_name ?? "—"}</td>
                              <td className="px-3 py-2">
                                {r.from_specialty ?? "—"} → <span className="font-semibold">{r.to_specialty}</span>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 font-bold ${r.status === "approved" ? "bg-teal-100 text-teal-800" : "bg-red-100 text-red-800"}`}
                                >
                                  {r.status === "approved" ? "Approved" : "Rejected"}
                                </span>
                                {r.rejection_reason ? <span className="ml-1 text-ink-500">— {r.rejection_reason}</span> : null}
                              </td>
                              <td className="px-3 py-2 text-ink-500">{r.reviewed_at ? fmt(r.reviewed_at) : "—"}</td>
                              <td className="px-3 py-2 text-right">
                                {r.evidence_path && (
                                  <button
                                    onClick={() => openFile(`/api/admin/specialty-changes/${r.id}/evidence`, "Couldn't open the proof.")}
                                    className="font-semibold text-teal-700 underline underline-offset-2"
                                  >
                                    Proof
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
