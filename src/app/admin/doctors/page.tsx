"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";
import { formatPhone } from "@/lib/phone";
import { computePlatformFeeShare } from "@/lib/platformFee";
import { safeJson } from "@/lib/monitoredFetch";
import AdminDeleteDoctor from "@/components/AdminDeleteDoctor";

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
//
// Doctor public profile (2026-09-15): a separate "Pending profile
// submissions" queue for the bio/years/photo (+ CNIC, first time only)
// a doctor submits themselves (src/app/doctor/profile). This is
// independent of PMDC/fee approval — a long-active doctor can submit a
// profile at any time — and approving it is a plain RLS update, same as
// everything else here, since admin already has full write access to
// doctor_profiles.

interface DoctorRow {
  id: string;
  full_name: string;
  email: string | null;
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
  bio: string | null;
  years_of_experience: number | null;
  profile_photo_url: string | null;
  profile_status: "not_submitted" | "pending_review" | "approved" | "rejected";
  profile_rejection_reason: string | null;
  cnic_number: string | null;
  cnic_certificate_path: string | null;
  pmdc_certificate_path: string | null;
  requested_full_name: string | null;
  requested_consultation_fee: number | null;
  correction_reason: string | null;
  correction_status: "none" | "pending" | "approved" | "rejected";
  correction_rejection_reason: string | null;
}

// Specialty-wise grouping (2026-09-27, physician: "can we sort doctor on
// admin page specialty wise") — groups a list of doctors by their
// `specialty` string (already constrained to the shared SPECIALTIES list
// at registration, so exact-string grouping works cleanly) and sorts the
// groups alphabetically, with doctors inside each group sorted by name.
// A doctor with no specialty on file (only possible for very old test
// data predating the shared list) falls into a trailing "Unspecified"
// bucket rather than being dropped.
function groupBySpecialty<T extends { specialty: string | null; full_name: string }>(
  list: T[]
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of list) {
    const key = item.specialty?.trim() || "Unspecified";
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  const entries = Array.from(groups.entries());
  for (const [, members] of entries) {
    members.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }
  entries.sort(([a], [b]) => {
    if (a === "Unspecified") return 1;
    if (b === "Unspecified") return -1;
    return a.localeCompare(b);
  });
  return entries;
}

// Inactivity flags (0086): who has gone quiet. Purely informational - the
// admin decides whether to Deactivate. Loaded on the side so a missing
// migration can never break this page.
interface ActivityInfo {
  lastConsultationAt: string | null;
  lastLoginAt: string | null;
  noConsultation3m: boolean;
  notLoggedIn4d: boolean;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
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
  const [rejectingProfileId, setRejectingProfileId] = useState<string | null>(null);
  const [profileRejectionReason, setProfileRejectionReason] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [correctionShareDrafts, setCorrectionShareDrafts] = useState<Record<string, string>>({});
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [rejectingCorrectionId, setRejectingCorrectionId] = useState<string | null>(null);
  const [correctionRejectionReason, setCorrectionRejectionReason] = useState("");

  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState<Record<string, ActivityInfo> | null>(null);
  const [attention, setAttention] = useState<"all" | "consult" | "login">("all");
  const [deleteNote, setDeleteNote] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  // Doctors' private mobile numbers (0079). Loaded separately and fail-soft, so this
  // page keeps working even before that SQL script has been run.
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("doctor_profiles")
      .select(
        "id, full_name, email, specialty, is_active, created_at, verification_status, pmdc_number, consultation_fee, fee_status, rejection_reason, custom_platform_share, daily_patient_cap, bio, years_of_experience, profile_photo_url, profile_status, profile_rejection_reason, cnic_number, cnic_certificate_path, pmdc_certificate_path, requested_full_name, requested_consultation_fee, correction_reason, correction_status, correction_rejection_reason"
      )
      .order("created_at", { ascending: true });

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as DoctorRow[]);
    Promise.resolve(supabase.rpc("admin_doctor_activity")).then(
      ({ data: act, error: actError }) => {
        if (actError || !act) return setActivity(null);
        const m: Record<string, ActivityInfo> = {};
        for (const r of act as {
          doctor_id: string;
          last_consultation_at: string | null;
          last_login_at: string | null;
          no_consultation_3m: boolean;
          not_logged_in_4d: boolean;
        }[]) {
          m[r.doctor_id] = {
            lastConsultationAt: r.last_consultation_at,
            lastLoginAt: r.last_login_at,
            noConsultation3m: r.no_consultation_3m,
            notLoggedIn4d: r.not_logged_in_4d,
          };
        }
        setActivity(m);
      },
      () => setActivity(null)
    );
    const phoneRes = await supabase.from("doctor_profiles").select("id, phone");
    if (!phoneRes.error && phoneRes.data) {
      const map: Record<string, string> = {};
      for (const r of phoneRes.data as { id: string; phone: string | null }[]) {
        if (r.phone) map[r.id] = r.phone;
      }
      setPhones(map);
    }
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
    const { res, data } = await safeJson(`/api/admin/doctors/${id}/certificate`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
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

  // Doctor public profile (2026-09-15): views the doctor's scanned CNIC
  // via the same certificate route used for PMDC, distinguished by
  // ?type=cnic — same private bucket, same signed-URL-only access.
  async function viewCnic(id: string) {
    if (!supabase) return;
    setCertificateError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { res, data } = await safeJson(`/api/admin/doctors/${id}/certificate?type=cnic`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    if (!res.ok) {
      setCertificateError(data.error ?? "Couldn't open the CNIC.");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function approveProfile(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({ profile_status: "approved", profile_rejection_reason: null })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setProfileError(error.message);
      return;
    }
    await load();
  }

  async function rejectProfile(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        profile_status: "rejected",
        profile_rejection_reason: profileRejectionReason.trim() || null,
      })
      .eq("id", id);
    setUpdating(null);
    setRejectingProfileId(null);
    setProfileRejectionReason("");
    if (error) {
      setProfileError(error.message);
      return;
    }
    await load();
  }

  // Doctor correction requests for name/fee (2026-09-30/10-01,
  // physician: "can a doctor request correction in name and fee"). A
  // fee change goes through the exact same platform-share logic as a
  // fresh fee approval (approveFee above, computePlatformFeeShare) --
  // it's the same real-money decision either way, so it gets the same
  // rule: auto-computed up to PKR 1,500, otherwise the admin enters the
  // platform's share by hand before it can be approved. A name-only
  // request skips all of that and just copies the requested name over.
  async function approveCorrection(row: DoctorRow) {
    if (!supabase) return;
    setCorrectionError(null);

    const updates: Record<string, unknown> = {
      correction_status: "approved",
      correction_rejection_reason: null,
    };

    if (row.requested_full_name) {
      updates.full_name = row.requested_full_name;
    }

    if (row.requested_consultation_fee != null) {
      const result = computePlatformFeeShare(row.requested_consultation_fee);
      if (result.requiresApproval) {
        const raw = correctionShareDrafts[row.id];
        const platformShare = Number(raw);
        if (!raw || !Number.isFinite(platformShare) || platformShare < 0 || platformShare >= row.requested_consultation_fee) {
          setCorrectionError(
            `This requested fee (PKR ${row.requested_consultation_fee}) is over the auto-approval limit — enter a platform share between 0 and ${row.requested_consultation_fee - 1} before approving.`
          );
          return;
        }
        updates.custom_platform_share = platformShare;
      } else {
        updates.custom_platform_share = result.platformShare;
      }
      updates.consultation_fee = row.requested_consultation_fee;
    }

    setUpdating(row.id);
    const { error } = await supabase.from("doctor_profiles").update(updates).eq("id", row.id);
    setUpdating(null);
    if (error) {
      setCorrectionError(error.message);
      return;
    }
    setCorrectionShareDrafts((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
  }

  async function rejectCorrection(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        correction_status: "rejected",
        correction_rejection_reason: correctionRejectionReason.trim() || null,
      })
      .eq("id", id);
    setUpdating(null);
    setRejectingCorrectionId(null);
    setCorrectionRejectionReason("");
    if (error) {
      setCorrectionError(error.message);
      return;
    }
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

    const { res, data } = await safeJson("/api/admin/doctors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ fullName: fullName.trim(), email: email.trim() }),
    });
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

  // Search box (2026-10-14): narrows the three doctor lists by name, email,
  // specialty or PMDC number. The review queues above them are not filtered.
  const needle = search.trim().toLowerCase();
  const matchesSearch = (d: DoctorRow) =>
    !needle ||
    [d.full_name, d.email, d.specialty, d.pmdc_number, phones[d.id] ?? "", phones[d.id] ? formatPhone(phones[d.id]) : ""].some((v) => (v ?? "").toLowerCase().includes(needle));
  const pending = rows?.filter((d) => d.verification_status === "pending_review" && matchesSearch(d)) ?? [];
  const approvedAll = rows?.filter((d) => d.verification_status === "approved" && matchesSearch(d)) ?? [];
  const noConsultCount = approvedAll.filter((d) => d.is_active && activity?.[d.id]?.noConsultation3m).length;
  const noLoginCount = approvedAll.filter((d) => d.is_active && activity?.[d.id]?.notLoggedIn4d).length;
  const approved =
    attention === "consult"
      ? approvedAll.filter((d) => d.is_active && activity?.[d.id]?.noConsultation3m)
      : attention === "login"
        ? approvedAll.filter((d) => d.is_active && activity?.[d.id]?.notLoggedIn4d)
        : approvedAll;
  const rejected = rows?.filter((d) => d.verification_status === "rejected" && matchesSearch(d)) ?? [];
  const pendingProfiles = rows?.filter((d) => d.profile_status === "pending_review") ?? [];
  const pendingCorrections = rows?.filter((d) => d.correction_status === "pending") ?? [];

  // Grouped/sorted by specialty for the two lists an admin actually
  // scans doctor-by-doctor — see groupBySpecialty above.
  const pendingBySpecialty = groupBySpecialty(pending);
  const approvedBySpecialty = groupBySpecialty(approved);

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
            {profileError && <p className="text-sm text-red-700">{profileError}</p>}
            {correctionError && <p className="text-sm text-red-700">{correctionError}</p>}
            {deleteNote && (
              <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-800" role="status">
                {deleteNote}
              </p>
            )}

            <div>
              <label htmlFor="doctor-search" className="sr-only">
                Search doctors
              </label>
              <input
                id="doctor-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doctors by name, email, phone, specialty or PMDC number"
                className="w-full rounded-xl border border-[#d7e7e2] bg-white px-4 py-2.5 text-sm text-ink-900"
              />
            </div>

            {pendingCorrections.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Pending correction requests ({pendingCorrections.length})
                </h2>
                <p className="mt-1 text-xs text-ink-500">
                  A doctor asking to correct their displayed name or consultation fee. Nothing changes until you
                  approve it.
                </p>
                <ul className="mt-3 space-y-3">
                  {pendingCorrections.map((d) => {
                    const feeChange = d.requested_consultation_fee;
                    const needsShareInput = feeChange != null && computePlatformFeeShare(feeChange).requiresApproval;
                    return (
                      <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <div className="text-sm font-semibold text-ink-900">{d.full_name}</div>
                        <div className="mt-2 grid gap-2 text-xs text-ink-700 sm:grid-cols-2">
                          <div>
                            <span className="text-ink-500">Name: </span>
                            {d.requested_full_name ? (
                              <>
                                <span className="line-through text-ink-500">{d.full_name}</span>
                                {" → "}
                                <span className="font-semibold">{d.requested_full_name}</span>
                              </>
                            ) : (
                              <span className="text-ink-500">No change requested</span>
                            )}
                          </div>
                          <div>
                            <span className="text-ink-500">Fee: </span>
                            {feeChange != null ? (
                              <>
                                <span className="line-through text-ink-500">PKR {d.consultation_fee}</span>
                                {" → "}
                                <span className="font-semibold">PKR {feeChange}</span>
                              </>
                            ) : (
                              <span className="text-ink-500">No change requested</span>
                            )}
                          </div>
                        </div>
                        {d.correction_reason && (
                          <p className="mt-2 max-w-xl whitespace-pre-wrap text-xs italic text-ink-700">
                            &ldquo;{d.correction_reason}&rdquo;
                          </p>
                        )}

                        {needsShareInput && (
                          <div className="mt-3 flex items-center gap-2">
                            <label className="text-xs text-ink-700">
                              Platform share for the new fee (PKR, over the auto-approval limit):
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={feeChange! - 1}
                              value={correctionShareDrafts[d.id] ?? ""}
                              onChange={(e) =>
                                setCorrectionShareDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))
                              }
                              className="w-24 rounded-md border border-[#d7e7e2] px-2 py-1 text-xs"
                            />
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => approveCorrection(d)}
                            disabled={updating === d.id}
                            className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          {rejectingCorrectionId === d.id ? (
                            <div className="flex flex-1 items-center gap-2">
                              <input
                                value={correctionRejectionReason}
                                onChange={(e) => setCorrectionRejectionReason(e.target.value)}
                                placeholder="Reason (shown to the doctor)"
                                className="flex-1 rounded-md border border-[#d7e7e2] px-2 py-1.5 text-xs"
                              />
                              <button
                                onClick={() => rejectCorrection(d.id)}
                                disabled={updating === d.id}
                                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                              >
                                Confirm reject
                              </button>
                              <button
                                onClick={() => setRejectingCorrectionId(null)}
                                className="text-xs font-medium text-ink-500 underline underline-offset-2"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRejectingCorrectionId(d.id)}
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
              </section>
            )}

            {pendingProfiles.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Pending profile submissions ({pendingProfiles.length})
                </h2>
                <p className="mt-1 text-xs text-ink-500">
                  A doctor&rsquo;s own bio, years of experience, and photo — submitted from their dashboard. Nothing
                  here goes public until you approve it.
                </p>
                <ul className="mt-3 space-y-3">
                  {pendingProfiles.map((d) => (
                    <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {d.profile_photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={d.profile_photo_url}
                              alt={`${d.full_name}'s submitted photo`}
                              className="h-16 w-16 rounded-full border border-amber-300 object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-xs text-amber-700">
                              No photo
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold text-ink-900">{d.full_name}</div>
                            <div className="text-xs text-ink-500">
                              {d.specialty ?? "Family Medicine"} · {d.years_of_experience ?? "—"} years of experience
                            </div>
                            <p className="mt-2 max-w-md whitespace-pre-wrap text-xs text-ink-700">{d.bio}</p>
                            <div className="mt-2 text-xs text-ink-500">
                              CNIC #: {d.cnic_number ?? "—"}
                              {d.cnic_certificate_path && (
                                <>
                                  {" · "}
                                  <button
                                    onClick={() => viewCnic(d.id)}
                                    className="font-medium text-teal-700 underline underline-offset-2"
                                  >
                                    View scanned CNIC
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => approveProfile(d.id)}
                          disabled={updating === d.id}
                          className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
                        >
                          Approve profile
                        </button>
                        {rejectingProfileId === d.id ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              value={profileRejectionReason}
                              onChange={(e) => setProfileRejectionReason(e.target.value)}
                              placeholder="Reason (shown to the doctor)"
                              className="flex-1 rounded-md border border-[#d7e7e2] px-2 py-1.5 text-xs"
                            />
                            <button
                              onClick={() => rejectProfile(d.id)}
                              disabled={updating === d.id}
                              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                            >
                              Confirm reject
                            </button>
                            <button
                              onClick={() => setRejectingProfileId(null)}
                              className="text-xs font-medium text-ink-500 underline underline-offset-2"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRejectingProfileId(d.id)}
                            className="text-xs font-medium text-red-700 underline underline-offset-2"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Pending applications {pending.length > 0 && `(${pending.length})`}
              </h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-ink-500">Loading…</p>
              ) : pending.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">No applications waiting for review.</p>
              ) : (
                <div className="mt-3 space-y-5">
                  {pendingBySpecialty.map(([specialty, doctors]) => (
                    <div key={specialty}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        {specialty} ({doctors.length})
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {doctors.map((d) => {
                          const feeResult = computePlatformFeeShare(d.consultation_fee ?? 0);
                          return (
                            <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-ink-900">{d.full_name}</div>
                            <div className="text-xs text-ink-500">{d.specialty ?? "No specialty given"}</div>
                            <div className="text-xs text-ink-500">
                              {d.email ? (
                              <a href={`mailto:${d.email}`} className="text-teal-700 underline underline-offset-2">
                                {d.email}
                              </a>
                            ) : (
                              <span>No email on file</span>
                            )}
                            </div>
                            <div className="text-xs text-ink-500">
                              {phones[d.id] ? <>Mobile: {formatPhone(phones[d.id])}</> : <span className="text-amber-800">No mobile number yet</span>}
                            </div>
                            <div className="mt-1 text-xs text-ink-500">
                              PMDC #: {d.pmdc_number ?? "—"} · Requested fee: PKR {d.consultation_fee ?? "—"}
                              {!feeResult.requiresApproval && (
                                <> (platform share PKR {feeResult.platformShare})</>
                              )}
                            </div>
                            {!d.pmdc_certificate_path && (
                              <p className="mt-1 text-xs font-bold text-red-700">
                                ⚠ PMDC certificate not uploaded yet — do not approve until it arrives (the doctor can finish at /doctor/upload-certificate).
                              </p>
                            )}
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
                            disabled={updating === d.id || !d.pmdc_certificate_path}
                            className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          {rejectingId === d.id ? (
                            <div className="flex flex-1 items-center gap-2">
                              <input
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="Reason (shown to the applicant)"
                                className="flex-1 rounded-md border border-[#d7e7e2] px-2 py-1.5 text-xs"
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
                                className="text-xs font-medium text-ink-500 underline underline-offset-2"
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
                          <AdminDeleteDoctor
                            id={d.id}
                            name={d.full_name}
                            onDeleted={(m) => {
                              setDeleteNote(m);
                              void load();
                            }}
                          />
                        </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-[#d7e7e2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
              <h2 className="text-sm font-semibold text-ink-900">Add a doctor directly</h2>
              <p className="mt-1 text-xs text-ink-500">
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
                  className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {adding ? "Inviting…" : "Invite doctor"}
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Active doctors</h2>
              {activity && (
                <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="activity-filters">
                  {(
                    [
                      ["all", "All doctors"],
                      ["consult", `No consultation in 3 months (${noConsultCount})`],
                      ["login", `Not logged in for 4 days (${noLoginCount})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setAttention(key)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        attention === key
                          ? "border-teal-700 bg-teal-700 text-white"
                          : "border-[#d7e7e2] bg-white text-ink-700 hover:bg-teal-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="text-xs text-ink-500">
                    To remove a doctor who has gone quiet, use Deactivate on their row.
                  </span>
                </div>
              )}
              {rows === null ? (
                <p className="mt-3 text-sm text-ink-500">Loading…</p>
              ) : approved.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">
                  {attention === "all" ? "No approved doctors yet." : "No doctors match this flag right now."}
                </p>
              ) : (
                <div className="mt-3 space-y-5">
                  {approvedBySpecialty.map(([specialty, doctors]) => (
                    <div key={specialty}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        {specialty} ({doctors.length})
                      </h3>
                      <ul className="mt-2 space-y-2">
                        {doctors.map((d) => (
                          <li
                            key={d.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d7e7e2] bg-white px-4 py-3 shadow-sm"
                          >
                      <div>
                        <div className="text-sm font-medium text-ink-900">{d.full_name}</div>
                        <div className="text-xs text-ink-500">
                          {d.email ? (
                            <>
                              <a href={`mailto:${d.email}`} className="text-teal-700 underline underline-offset-2">
                                {d.email}
                              </a>{" "}
                              ·{" "}
                            </>
                          ) : null}
                          {phones[d.id] ? <>{formatPhone(phones[d.id])} · </> : <><span className="text-amber-800">No mobile yet</span> · </>}
                          {d.specialty ?? "Family Medicine"} · Joined {new Date(d.created_at).toLocaleDateString()}
                          {d.consultation_fee != null && <> · PKR {d.consultation_fee}/consult</>}
                          {d.custom_platform_share != null && (
                            <> (platform share PKR {d.custom_platform_share})</>
                          )}
                        </div>
                        {d.is_active && activity?.[d.id] && (activity[d.id].noConsultation3m || activity[d.id].notLoggedIn4d) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="activity-badges">
                            {activity[d.id].noConsultation3m && (
                              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                                No consultation in 3 months &middot; last: {ago(activity[d.id].lastConsultationAt)}
                              </span>
                            )}
                            {activity[d.id].notLoggedIn4d && (
                              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                                Not logged in for 4 days &middot; last seen: {ago(activity[d.id].lastLoginAt)}
                              </span>
                            )}
                          </div>
                        )}
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
                          <span className="text-xs text-ink-500">Daily patient cap (all consult types):</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={capDrafts[d.id] ?? String(d.daily_patient_cap)}
                            onChange={(e) => setCapDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                            className="w-20 rounded-md border border-[#d7e7e2] px-2 py-1 text-xs"
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
                          <span className="text-xs text-ink-500">Default is 100 — only admin can raise it.</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            d.is_active ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-ink-700"
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
                        <AdminDeleteDoctor
                            id={d.id}
                            name={d.full_name}
                            onDeleted={(m) => {
                              setDeleteNote(m);
                              void load();
                            }}
                          />
                      </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {rejected.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Rejected applications
                </h2>
                <ul className="mt-3 space-y-2">
                  {rejected.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-lg border border-[#d7e7e2] bg-[#f1f8f5] px-4 py-3 text-xs text-ink-500"
                    >
                      <span className="font-medium text-ink-700">{d.full_name}</span>
                      {d.email && (
                        <>
                          {" "}
                          (<a href={`mailto:${d.email}`} className="text-teal-700 underline underline-offset-2">{d.email}</a>)
                        </>
                      )}
                      {phones[d.id] && <> · {formatPhone(phones[d.id])}</>}
                      {d.rejection_reason && <> — {d.rejection_reason}</>}
                      <div className="mt-1">
                        <AdminDeleteDoctor
                            id={d.id}
                            name={d.full_name}
                            onDeleted={(m) => {
                              setDeleteNote(m);
                              void load();
                            }}
                          />
                      </div>
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
