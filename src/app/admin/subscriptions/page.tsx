"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/monitoredFetch";

// Doctor onboarding, step 4: admin visibility into the PKR 2,500/month
// platform subscription — built now, deliberately not enforced anywhere
// yet (see 0030's migration comment and the payments webhook route for
// the full reasoning). This page has two jobs: show each approved
// doctor's subscription status (as the webhook has recorded it), and
// give admin a manual override for when automatic email-matching
// couldn't find a doctor — the fallback this project's own research
// found is genuinely necessary, not just a nice-to-have (Safepay's
// subscription webhooks carry no merchant-supplied identifier, only the
// subscriber's email).
//
// Step 6 (2026-09-21): real enforcement is now live behind a flag
// (0043/0044), doctors pay by bank transfer/JazzCash instead of a
// Safepay subscription, and this page grew three things to match — a
// renewal countdown per doctor (computed straight from the same
// subscription_current_period_end already shown below), an editable
// "payment instructions" box (platform_settings, 0044) so the bank/
// JazzCash details doctors see can be updated without a code change,
// and a review queue for the payment proofs doctors submit from their
// own dashboard. "Mark paid" is still the one action that actually
// activates a doctor — approving a proof here just calls it for you.

type SubStatus = "unpaid" | "active" | "past_due" | "canceled";

interface DoctorRow {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  subscription_status: SubStatus;
  safepay_subscription_id: string | null;
  subscription_current_period_end: string | null;
  subscription_last_event_at: string | null;
}

interface UnmatchedEvent {
  id: string;
  event_type: string;
  customer_email: string | null;
  safepay_subscription_id: string | null;
  created_at: string;
}

interface PendingProof {
  id: string;
  doctor_id: string;
  method: "bank_transfer" | "jazzcash";
  note: string | null;
  created_at: string;
}

interface PlatformSettingsRow {
  doctor_subscription_bank_details: string | null;
  doctor_subscription_jazzcash_details: string | null;
}

// Migration 0076 (Safepay checkout for doctor access) — both are optional
// extras: if 0076 hasn't been run these stay null and the page looks and
// works exactly as before.
interface AccessPaymentRow {
  id: string;
  doctor_id: string;
  amount: number;
  status: "pending" | "succeeded";
  paid_at: string | null;
  period_end: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<SubStatus, string> = {
  active: "bg-teal-100 text-teal-800",
  unpaid: "bg-slate-200 text-slate-600",
  past_due: "bg-amber-100 text-amber-800",
  canceled: "bg-red-100 text-red-800",
};

// Renewal countdown, computed live from subscription_current_period_end
// — the same field and the same "no stored flag, just compare dates"
// approach the database itself now uses (0044) to auto-expire access.
// Purely a display string here; it doesn't change what's enforced.
function renewalLabel(row: DoctorRow): { text: string; overdue: boolean } | null {
  if (row.subscription_status !== "active" || !row.subscription_current_period_end) return null;
  const end = new Date(row.subscription_current_period_end).getTime();
  const daysLeft = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { text: `overdue by ${Math.abs(daysLeft)}d`, overdue: true };
  if (daysLeft === 0) return { text: "due today", overdue: true };
  return { text: `renews in ${daysLeft}d`, overdue: daysLeft <= 5 };
}

export default function AdminSubscriptions() {
  const [rows, setRows] = useState<DoctorRow[] | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedEvent[] | null>(null);
  const [pendingProofs, setPendingProofs] = useState<PendingProof[] | null>(null);
  const [settings, setSettings] = useState<PlatformSettingsRow | null>(null);
  const [bankDraft, setBankDraft] = useState("");
  const [jazzcashDraft, setJazzcashDraft] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [safepayFlags, setSafepayFlags] = useState<Record<string, boolean> | null>(null);
  const [accessPayments, setAccessPayments] = useState<AccessPaymentRow[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    // Optional extras from 0076 — never allowed to break the main page.
    Promise.resolve(supabase.from("doctor_profiles").select("id, use_safepay_checkout")).then(
      ({ data, error }) => {
        if (error || !data) return setSafepayFlags(null);
        const m: Record<string, boolean> = {};
        for (const r of data as { id: string; use_safepay_checkout: boolean }[]) m[r.id] = r.use_safepay_checkout;
        setSafepayFlags(m);
      },
      () => setSafepayFlags(null)
    );
    Promise.resolve(
      supabase
        .from("doctor_access_payments")
        .select("id, doctor_id, amount, status, paid_at, period_end, created_at")
        .order("created_at", { ascending: false })
        .limit(15)
    ).then(
      ({ data, error }) => setAccessPayments(error || !data ? null : (data as AccessPaymentRow[])),
      () => setAccessPayments(null)
    );
    const [doctorsRes, eventsRes, proofsRes, settingsRes] = await Promise.all([
      supabase
        .from("doctor_profiles")
        .select(
          "id, full_name, email, is_active, subscription_status, safepay_subscription_id, subscription_current_period_end, subscription_last_event_at"
        )
        .eq("verification_status", "approved")
        .order("full_name"),
      supabase
        .from("doctor_subscription_events")
        .select("id, event_type, customer_email, safepay_subscription_id, created_at")
        .eq("matched", false)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("doctor_subscription_payment_proofs")
        .select("id, doctor_id, method, note, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("platform_settings")
        .select("doctor_subscription_bank_details, doctor_subscription_jazzcash_details")
        .eq("id", 1)
        .maybeSingle(),
    ]);
    if (doctorsRes.error) {
      setLoadError(doctorsRes.error.message);
    } else {
      setRows(doctorsRes.data as DoctorRow[]);
    }
    if (!eventsRes.error) {
      setUnmatched(eventsRes.data as UnmatchedEvent[]);
    }
    if (!proofsRes.error) {
      setPendingProofs(proofsRes.data as PendingProof[]);
    }
    if (!settingsRes.error && settingsRes.data) {
      const s = settingsRes.data as PlatformSettingsRow;
      setSettings(s);
      setBankDraft(s.doctor_subscription_bank_details ?? "");
      setJazzcashDraft(s.doctor_subscription_jazzcash_details ?? "");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSettings() {
    if (!supabase) return;
    setSavingSettings(true);
    setSettingsSaved(false);
    const { error } = await supabase
      .from("platform_settings")
      .update({
        doctor_subscription_bank_details: bankDraft.trim() || null,
        doctor_subscription_jazzcash_details: jazzcashDraft.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSavingSettings(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setSettingsSaved(true);
    await load();
  }

  async function viewProof(proofId: string) {
    if (!supabase) return;
    setProofError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { res, data } = await safeJson(`/api/admin/subscriptions/proof/${proofId}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    if (!res.ok) {
      setProofError(data.error ?? "Couldn't open this payment proof.");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function approveProof(proof: PendingProof) {
    if (!supabase) return;
    setReviewing(proof.id);
    await markPaid(proof.doctor_id);
    await supabase
      .from("doctor_subscription_payment_proofs")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", proof.id);
    setReviewing(null);
    await load();
  }

  async function rejectProof(proof: PendingProof) {
    if (!supabase) return;
    setReviewing(proof.id);
    await supabase
      .from("doctor_subscription_payment_proofs")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", proof.id);
    setReviewing(null);
    await load();
  }

  // Manual override: for when the webhook couldn't match a doctor by
  // email (wrong email used at Safepay checkout, event arrived before
  // the doctor even registered here, etc.) — cross-reference the
  // unmatched event list above or Safepay's own dashboard (its
  // per-subscription "User Details" panel shows the subscriber's email)
  // and mark it here. A future webhook for the SAME subscription id, if
  // one arrives, will simply update this same row going forward once
  // safepay_subscription_id is set — but this manual click never
  // requires one to have happened yet.
  async function markPaid(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        subscription_status: "active",
        subscription_current_period_end: periodEnd.toISOString(),
        subscription_last_event_at: new Date().toISOString(),
      })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function markUnpaid(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({ subscription_status: "canceled" })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  // Switch one doctor (or everyone) between the Safepay checkout and the
  // manual bank/JazzCash route. Only changes which payment screen the
  // doctor is shown; never touches their paid period.
  async function setSafepayFor(id: string | null, value: boolean) {
    if (!supabase) return;
    setUpdating(id ?? "all");
    const q = supabase.from("doctor_profiles").update({ use_safepay_checkout: value });
    const { error } = id ? await q.eq("id", id) : await q.neq("id", "00000000-0000-0000-0000-000000000000");
    setUpdating(null);
    setConfirmAll(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  return (
    <AdminGuard title="Doctor subscriptions">
      {() => (
        <div>
          <PageHeader
            title="Doctor subscriptions"
            subtitle="PKR 2,500 per 30 days, paid through Safepay checkout or (for doctors not yet switched over) bank transfer / JazzCash. Review proofs below, or mark a doctor paid/canceled by hand."
          />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Payment instructions shown to doctors
              </h2>
              <p className="mt-1 text-xs text-ink-500">
                Editable any time — no code change or redeploy needed. A doctor sees whatever is saved here on their
                own dashboard.
              </p>
              <div className="mt-3 space-y-3 rounded-2xl border border-[#d7e7e2] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
                <div>
                  <label className="text-xs font-semibold text-ink-700">Bank transfer details</label>
                  <textarea
                    value={bankDraft}
                    onChange={(e) => setBankDraft(e.target.value)}
                    rows={3}
                    placeholder="Bank name, account title, account number, IBAN…"
                    className="mt-1 w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-700">JazzCash details</label>
                  <textarea
                    value={jazzcashDraft}
                    onChange={(e) => setJazzcashDraft(e.target.value)}
                    rows={2}
                    placeholder="JazzCash number, account title…"
                    className="mt-1 w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={savingSettings}
                    className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    {savingSettings ? "Saving…" : "Save"}
                  </button>
                  {settingsSaved && <span className="text-xs text-teal-700">Saved.</span>}
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Payment proof awaiting review {pendingProofs && pendingProofs.length > 0 && `(${pendingProofs.length})`}
              </h2>
              {proofError && <p className="mt-2 text-sm text-red-700">{proofError}</p>}
              {pendingProofs === null ? (
                <p className="mt-3 text-sm text-ink-500">Loading…</p>
              ) : pendingProofs.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">Nothing waiting on review.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {pendingProofs.map((p) => {
                    const doctor = rows?.find((d) => d.id === p.doctor_id);
                    return (
                      <li
                        key={p.id}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-medium text-ink-900">{doctor?.full_name ?? "Unknown doctor"}</span>
                            <span className="ml-2 text-xs text-ink-500">
                              {p.method === "bank_transfer" ? "Bank transfer" : "JazzCash"} ·{" "}
                              {new Date(p.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => viewProof(p.id)}
                              className="text-xs font-medium text-teal-700 underline underline-offset-2"
                            >
                              View
                            </button>
                            <button
                              onClick={() => approveProof(p)}
                              disabled={reviewing === p.id}
                              className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                            >
                              Approve → mark paid
                            </button>
                            <button
                              onClick={() => rejectProof(p)}
                              disabled={reviewing === p.id}
                              className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                        {p.note && <p className="mt-1 text-xs text-ink-700">&ldquo;{p.note}&rdquo;</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Doctors</h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-ink-500">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">No approved doctors yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rows.map((d) => {
                    const renewal = renewalLabel(d);
                    return (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d7e7e2] bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-ink-900">{d.full_name}</div>
                        <div className="text-xs text-ink-500">
                          {d.email ?? "no email on file"}
                          {renewal && (
                            <>
                              {" · "}
                              <span className={renewal.overdue ? "font-semibold text-amber-700" : undefined}>
                                {renewal.text}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[d.subscription_status]}`}
                        >
                          {d.subscription_status}
                        </span>
                        {safepayFlags && d.id in safepayFlags && (
                          <button
                            onClick={() => setSafepayFor(d.id, !safepayFlags[d.id])}
                            disabled={updating === d.id}
                            title="Which payment screen this doctor sees when payment is due"
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
                              safepayFlags[d.id] ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {safepayFlags[d.id] ? "Safepay checkout" : "Manual (bank/JazzCash)"}
                          </button>
                        )}
                        {d.subscription_status !== "active" && (
                          <button
                            onClick={() => markPaid(d.id)}
                            disabled={updating === d.id}
                            className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                        )}
                        {d.subscription_status === "active" && (
                          <button
                            onClick={() => markUnpaid(d.id)}
                            disabled={updating === d.id}
                            className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark canceled
                          </button>
                        )}
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {safepayFlags && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Safepay checkout</h2>
                <p className="mt-1 text-xs text-ink-500">
                  Doctors marked &ldquo;Safepay checkout&rdquo; pay PKR 2,500 online for 30 days; their access starts
                  by itself when the payment is confirmed. Doctors still on &ldquo;Manual&rdquo; keep the
                  bank/JazzCash route until you switch them &mdash; tap a doctor&rsquo;s tag above to switch one, or
                  switch everyone here. Switching never changes anyone&rsquo;s paid period.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {!confirmAll ? (
                    <button
                      onClick={() => setConfirmAll(true)}
                      className="rounded-full border border-teal-700 px-4 py-1.5 text-xs font-semibold text-teal-700"
                    >
                      Switch ALL doctors to Safepay checkout
                    </button>
                  ) : (
                    <>
                      <span className="text-xs text-ink-700">Everyone will pay through Safepay from their next renewal.</span>
                      <button
                        onClick={() => setSafepayFor(null, true)}
                        disabled={updating === "all"}
                        className="rounded-full bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {updating === "all" ? "Switching…" : "Yes, switch everyone"}
                      </button>
                      <button onClick={() => setConfirmAll(false)} className="text-xs font-medium text-ink-500 underline">
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {accessPayments && accessPayments.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {accessPayments.map((p) => {
                      const who = rows?.find((r) => r.id === p.doctor_id)?.full_name ?? "Doctor";
                      return (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d7e7e2] bg-white px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-ink-900">{who}</span>
                          <span className="text-ink-500">
                            PKR {p.amount.toLocaleString()} &middot;{" "}
                            {p.status === "succeeded"
                              ? `paid ${new Date(p.paid_at ?? p.created_at).toLocaleDateString()}${
                                  p.period_end ? `, access until ${new Date(p.period_end).toLocaleDateString()}` : ""
                                }`
                              : `started ${new Date(p.created_at).toLocaleDateString()}, not paid`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {unmatched !== null && unmatched.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                  Unmatched subscription events ({unmatched.length})
                </h2>
                <p className="mt-1 text-xs text-ink-500">
                  A Safepay subscription event arrived whose email didn&rsquo;t match any doctor on file. Find the
                  right doctor above (check Safepay&rsquo;s own dashboard for the subscriber&rsquo;s details if
                  needed) and use &ldquo;Mark paid&rdquo;.
                </p>
                <ul className="mt-3 space-y-2">
                  {unmatched.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
                    >
                      <span className="font-medium">{e.event_type}</span> — {e.customer_email ?? "no email in payload"}
                      {" · "}
                      {new Date(e.created_at).toLocaleString()}
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
