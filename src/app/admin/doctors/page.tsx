"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";
import { computePlatformFeeShare } from "@/lib/platformFee";

// Admin system, step 2: doctor management. "Add a doctor" invites a new
// account by email (src/app/api/admin/doctors) and creates their
// doctor_profiles row in the same step — replacing what used to be a
// manual sign-up + SQL insert. Activate/deactivate is a plain RLS-backed
// update, no API route needed for that part.
//
// Doctor onboarding, step 1 (2026-09-14): adds a "Pending applications"
// review queue for doctors who self-registered (src/app/doctor/register)
// instead of being admin-invited — the physician's own scaling problem
// with invite-by-hand for five incoming doctors. Approving here is what
// actually makes a doctor visible/bookable; nothing about self-
// registration bypasses this review.

interface DoctorRow {
  id: string;
  full_name: string;
  specialty: string | null;
  is_active: boolean;
  created_at: string;
  verification_status: "pending_review" | "approved" | "rejected";
  pmdc_number: string | null;
  consultation_fee: number | null;
  fee_status: "not_set" | "approved" | "pending_admin_approval";
  rejection_reason: string | null;
  custom_platform_share: number | null;
  daily_patient_cap: number;
}

export default function AdminDoctors() {
  const [rows, setRows] = useState<DoctorRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [feeApprovalDrafts, setFeeApprovalDrafts] = useState<Record<string, string>>({});
  const [feeApprovalError, setFeeApprovalError] = useState<string | null>(null);
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
  const [capError, setCapError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("doctor_profiles")
      .select(
        "id, full_name, specialty, is_active, created_at, verification_status, pmdc_number, consultation_fee, fee_status, rejection_reason, custom_platform_share, daily_patient_cap"
      )
      .order("created_at", { ascending: true });

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as DoctorRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(id: string, next: boolean) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase.from("doctor_profiles").update({ is_active: next }).eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function viewCertificate(id: string) {
    if (!supabase) return;
    setCertificateError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/doctors/${id}/certificate`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCertificateError(data.error ?? "Couldn't open the certificate.");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  // Approving PMDC verification also settles the fee side automatically
  // when it fits within the confirmed tiers (<=1500) — a fee above that
  // needs a distinct, explicit second click (approveFee below) before
  // the doctor actually goes live, even though their PMDC status is
  // already approved.
  async function approveApplication(row: DoctorRow) {
    if (!supabase) return;
    setUpdating(row.id);
    const result = computePlatformFeeShare(row.consultation_fee ?? 0);
    const { error } = await supabase
      .from("doctor_profiles")
      .update(
        result.requiresApproval
          ? { verification_status: "approved", fee_status: "pending_admin_approval", is_active: false }
          : { verification_status: "approved", fee_status: "approved", is_active: true }
      )
      .eq("id", row.id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  // For a fee above PKR 1,500 the platform-share split isn't
  // auto-computed (confirmed with the physician: only approval up to
  // 1,500 is automatic) — admin decides and enters the exact PKR amount
  // the platform keeps, which is what the real payment route (Phase 10,
  // step 2) will actually charge against once this doctor goes live.
  // Recorded on custom_platform_share (0029); nothing here goes live
  // until that number is set.
  async function approveFee(row: DoctorRow) {
    if (!supabase) return;
    setFeeApprovalError(null);
    const raw = feeApprovalDrafts[row.id];
    const platformShare = Number(raw);
    const fee = row.consultation_fee ?? 0;
    if (!raw || !Number.isFinite(platformShare) || platformShare < 0 || platformShare >= fee) {
      setFeeApprovalError(`Enter a platform share between 0 and ${fee - 1} for this doctor.`);
      return;
    }
    setUpdating(row.id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({ fee_status: "approved", is_active: true, custom_platform_share: platformShare })
      .eq("id", row.id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setFeeApprovalDrafts((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
  }

  // Daily patient cap (2026-09-15): combined ceiling across every
  // delivery mode, enforced in the database (0033). Only admin can
  // change it — doctor_profiles has no doctor-facing UPDATE policy, so
  // this write only ever succeeds for an admin session, same as the
  // platform-share field above.
  async function saveCap(row: DoctorRow) {
    if (!supabase) return;
    setCapError(null);
    const raw = capDrafts[row.id] ?? String(row.daily_patient_cap);
    const cap = Number(raw);
    if (!raw || !Number.isFinite(cap) || !Number.isInteger(cap) || cap <= 0) {
      setCapError("Enter a whole number greater than 0 for the daily patient cap.");
      return;
    }
    setUpdating(row.id);
    const { error } = await supabase.from("doctor_profiles").update({ daily_patient_cap: cap }).eq("id", row.id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setCapDrafts((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
  }

  async function rejectApplication(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        verification_status: "rejected",
        rejection_reason: rejectionReason.trim() || null,
        is_active: false,
      })
      .eq("id", id);
    setUpdating(null);
    setRejectingId(null);
    setRejectionReason("");
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function addDoctor(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setAddError(null);
    setAddSuccess(null);

    if (!fullName.trim() || !email.trim()) {
      setAddError("Please enter both a name and an email.");
      return;
    }

    setAdding(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/admin/doctors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ fullName: fullName.trim(), email: email.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setAdding(false);

    if (!res.ok) {
      setAddError(data.error ?? "Something went wrong.");
      return;
    }

    setAddSuccess(`Invited ${fullName.trim()} — they'll get an email to set their own password.`);
    setFullName("");
    setEmail("");
    await load();
  }

  const pending = rows?.filter((d) => d.verification_status === "pending_review") ?? [];
  const approved = rows?.filter((d) => d.verification_status === "approved") ?? [];
  const rejected = rows?.filter((d) => d.verification_status === "rejected") ?? [];

  return (
    <AdminGuard title="Doctors">
      {() => (
        <div>
          <PageHeader title="Doctors" subtitle="Review applications, add a doctor, or manage an existing one." />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}
            {certificateError && <p className="text-sm text-red-700">{certificateError}</p>}
            {feeApprovalError && <p className="text-sm text-red-700">{feeApprovalError}</p>}
            {capError && <p className="text-sm text-red-700">{capError}</p>}

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Pending applications {pending.length > 0 && `(${pending.length})`}
              </h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : pending.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No applications waiting for review.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {pending.map((d) => {
                    const feeResult = computePlatformFeeShare(d.consultation_fee ?? 0);
                    return (
                      <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{d.full_name}</div>
                            <div className="text-xs text-slate-500">{d.specialty ?? "No specialty given"}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              PMDC #: {d.pmdc_number ?? "—"} · Requested fee: PKR {d.consultation_fee ?? "—"}
                              {!feeResult.requiresApproval && (
                                <> (platform share PKR {feeResult.platformShare})</>
                              )}
                            </div>
                            {feeResult.requiresApproval && (
                              <p className="mt-1 text-xs font-medium text-amber-800">
                                Fee above PKR 1,500 — will need a separate fee approval after PMDC approval.
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => viewCertificate(d.id)}
                            className="rounded-md border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                          >
                            View PMDC certificate
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => approveApplication(d)}
                            disabled={updating === d.id}
                            className="rounded-md bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          {rejectingId === d.id ? (
                            <div className="flex flex-1 items-center gap-2">
                              <input
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="Reason (shown to the applicant)"
                                className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                              />
                              <button
                                onClick={() => rejectApplication(d.id)}
                                disabled={updating === d.id}
                                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                              >
                                Confirm reject
                              </button>
                              <button
                                onClick={() => setRejectingId(null)}
                                className="text-xs font-medium text-slate-500 underline underline-offset-2"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRejectingId(d.id)}
                              className="text-xs font-medium text-red-700 underline underline-offset-2"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Add a doctor directly</h2>
              <p className="mt-1 text-xs text-slate-500">
                For staff you invite yourself, skipping the application form — they&rsquo;ll receive an email invite
                to set their own password.
              </p>
              <form onSubmit={addDoctor} className="mt-4 space-y-4">
                <FormField label="Full name" name="fullName" value={fullName} onChange={setFullName} required />
                <FormField label="Email" name="email" type="email" value={email} onChange={setEmail} required />
                {addError && <p className="text-sm text-red-700">{addError}</p>}
                {addSuccess && <p className="text-sm text-teal-700">{addSuccess}</p>}
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {adding ? "Inviting…" : "Invite doctor"}
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Active doctors</h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : approved.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No approved doctors yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {approved.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{d.full_name}</div>
                        <div className="text-xs text-slate-400">
                          {d.specialty ?? "Family Medicine"} · Joined {new Date(d.created_at).toLocaleDateString()}
                          {d.consultation_fee != null && <> · PKR {d.consultation_fee}/consult</>}
                          {d.custom_platform_share != null && (
                            <> (platform share PKR {d.custom_platform_share})</>
                          )}
                        </div>
                        {d.fee_status === "pending_admin_approval" && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2">
                            <span className="text-xs text-amber-800">
                              Platform&rsquo;s share of PKR {d.consultation_fee}:
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={(d.consultation_fee ?? 1) - 1}
                              value={feeApprovalDrafts[d.id] ?? ""}
                              onChange={(e) =>
                                setFeeApprovalDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))
                              }
                              placeholder="PKR"
                              className="w-24 rounded-md border border-amber-300 px-2 py-1 text-xs"
                            />
                            <button
                              onClick={() => approveFee(d)}
                              disabled={updating === d.id}
                              className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
                            >
                              Confirm &amp; activate
                            </button>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Daily patient cap (all consult types):</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={capDrafts[d.id] ?? String(d.daily_patient_cap)}
                            onChange={(e) => setCapDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => saveCap(d)}
                            disabled={
                              updating === d.id ||
                              (capDrafts[d.id] ?? String(d.daily_patient_cap)) === String(d.daily_patient_cap)
                            }
                            className="rounded-md border border-teal-600 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <span className="text-xs text-slate-400">Default is 100 — only admin can raise it.</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            d.is_active ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {d.is_active ? "Active" : "Inactive"}
                        </span>
                        <button
                          onClick={() => toggleActive(d.id, !d.is_active)}
                          disabled={updating === d.id}
                          className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          {d.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {rejected.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Rejected applications
                </h2>
                <ul className="mt-3 space-y-2">
                  {rejected.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500"
                    >
                      <span className="font-medium text-slate-700">{d.full_name}</span>
                      {d.rejection_reason && <> — {d.rejection_reason}</>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
