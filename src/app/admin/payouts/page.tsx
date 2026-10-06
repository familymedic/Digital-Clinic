"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Doctor payouts (rebuilt 2026-10-05 — see 0063_doctor_earnings_and_payouts.sql).
//
// How it works now: a doctor sees their own earnings on /doctor/earnings
// and presses "Request payout". The database works out the amount (every
// completed, non-refunded, production payment that has cleared the hold
// period) and CLAIMS those payments, so the same consultation can never be
// paid twice. Requests show up at the top of this page. Actually paying a
// doctor is still a real bank transfer you make yourself — "Mark paid"
// records that it happened (with the transfer reference), and the doctor
// then sees it as settled. The old month-by-month generator is replaced by
// "Create payout" in the balances table, which uses the same claiming
// mechanism, so the two can't double count.
//
// Test payments (sandbox) never count unless "Include test payments" is
// switched on below, which exists only so the whole flow can be tried
// before go-live.

interface Balance {
  doctor_id: string;
  full_name: string;
  available: number;
  upcoming: number;
  in_progress: number;
  paid_total: number;
  has_bank_details: boolean;
  details_changed_at: string | null;
  open_payout_id: string | null;
}

interface BankSnapshot {
  account_title?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  wallet_provider?: string | null;
  wallet_number?: string | null;
  details_changed_at?: string | null;
}

interface PayoutRow {
  id: string;
  doctor_id: string;
  period_start: string;
  period_end: string;
  consultation_count: number;
  amount: number;
  status: "requested" | "pending" | "paid" | "cancelled";
  source: "admin" | "doctor_request";
  requested_at: string | null;
  bank_snapshot: BankSnapshot | null;
  details_via_email: boolean;
  transfer_reference: string | null;
  note: string | null;
  paid_at: string | null;
  created_at: string;
}

interface Settings {
  hold_days: number;
  min_payout: number;
  include_test_payments: boolean;
}

const money = (n: number) => `PKR ${Number(n ?? 0).toLocaleString()}`;
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric" }) : "—";
const RECENT_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked: nothing to do, the text is visible to select.
  }
}

export default function AdminPayouts() {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [refDraft, setRefDraft] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [holdDraft, setHoldDraft] = useState("3");
  const [minDraft, setMinDraft] = useState("2000");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [balRes, payRes, setRes] = await Promise.all([
      supabase.rpc("admin_doctor_balances"),
      supabase.from("doctor_payouts").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("payout_settings").select("hold_days, min_payout, include_test_payments").maybeSingle(),
    ]);
    if (balRes.error) return setLoadError(balRes.error.message);
    if (payRes.error) return setLoadError(payRes.error.message);
    setLoadError(null);
    setBalances(balRes.data as Balance[]);
    setPayouts(payRes.data as PayoutRow[]);
    if (!setRes.error && setRes.data) {
      const s = setRes.data as Settings;
      setSettings(s);
      setHoldDraft(String(s.hold_days));
      setMinDraft(String(s.min_payout));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function doctorName(id: string): string {
    return balances?.find((b) => b.doctor_id === id)?.full_name ?? "Unknown doctor";
  }
  function detailsChangedAt(id: string): string | null {
    return balances?.find((b) => b.doctor_id === id)?.details_changed_at ?? null;
  }

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setActionError(null);
    const { error } = await fn();
    setBusy(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    await load();
  }

  async function saveSettings(patch?: Partial<Settings>) {
    if (!supabase) return;
    const hold = parseInt(holdDraft, 10);
    const min = parseInt(minDraft, 10);
    if (!Number.isFinite(hold) || hold < 0 || hold > 60 || !Number.isFinite(min) || min < 0) {
      setActionError("Hold days must be 0–60 and the minimum payout 0 or more.");
      return;
    }
    setSavingSettings(true);
    setActionError(null);
    setSettingsNote(null);
    const { error } = await supabase
      .from("payout_settings")
      .update({ hold_days: hold, min_payout: min, updated_at: new Date().toISOString(), ...patch })
      .eq("id", true);
    setSavingSettings(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setSettingsNote("Saved.");
    await load();
  }

  const open = (payouts ?? []).filter((p) => p.status === "requested" || p.status === "pending");
  const closed = (payouts ?? []).filter((p) => p.status === "paid" || p.status === "cancelled");
  const balanceRows = (balances ?? []).filter(
    (b) => b.available > 0 || b.upcoming > 0 || b.in_progress > 0 || b.paid_total > 0
  );

  return (
    <AdminGuard title="Doctor payouts">
      {() => (
        <div>
          <PageHeader
            title="Doctor payouts"
            subtitle="Doctors request payouts from their own Earnings page. You transfer the money, then mark it paid."
          />
          <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}
            {actionError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{actionError}</div>
            )}

            {settings?.include_test_payments && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Test payments are being counted as doctor earnings.</strong> This is only for trying the
                payout flow before go-live. Switch it off below before real money is involved.
              </div>
            )}

            {/* Requests */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Waiting for payment {open.length > 0 && <span className="text-amber-700">({open.length})</span>}
              </h2>
              {payouts === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : open.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No payouts are waiting. 🎉</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {open.map((p) => {
                    const snap = p.bank_snapshot;
                    const changed = detailsChangedAt(p.doctor_id);
                    const recentlyChanged = changed && Date.now() - new Date(changed).getTime() < RECENT_CHANGE_MS;
                    return (
                      <li key={p.id} className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{doctorName(p.doctor_id)}</div>
                            <div className="text-xs text-slate-500">
                              {p.source === "doctor_request" ? "Requested by the doctor" : "Created by admin"} on{" "}
                              {fmt(p.requested_at ?? p.created_at)} · {p.consultation_count} consultation
                              {p.consultation_count === 1 ? "" : "s"} ({p.period_start} – {p.period_end})
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-slate-900">{money(p.amount)}</div>
                            <div className="text-xs text-amber-700">
                              {p.status === "requested" ? "Requested" : "Pending"}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                          {snap ? (
                            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              {snap.account_number && (
                                <>
                                  <div>
                                    <dt className="text-xs text-slate-500">Account title</dt>
                                    <dd className="font-medium text-slate-900">{snap.account_title}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-slate-500">Bank</dt>
                                    <dd className="font-medium text-slate-900">{snap.bank_name}</dd>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <dt className="text-xs text-slate-500">Account number / IBAN</dt>
                                    <dd className="font-medium text-slate-900">
                                      {snap.account_number}{" "}
                                      <button
                                        onClick={() => copy(snap.account_number ?? "")}
                                        className="ml-1 text-xs font-medium text-teal-700 underline underline-offset-2"
                                      >
                                        Copy
                                      </button>
                                    </dd>
                                  </div>
                                </>
                              )}
                              {snap.wallet_number && (
                                <div>
                                  <dt className="text-xs text-slate-500">
                                    {snap.wallet_provider === "jazzcash" ? "JazzCash" : "Easypaisa"}
                                  </dt>
                                  <dd className="font-medium text-slate-900">
                                    {snap.wallet_number}{" "}
                                    <button
                                      onClick={() => copy(snap.wallet_number ?? "")}
                                      className="ml-1 text-xs font-medium text-teal-700 underline underline-offset-2"
                                    >
                                      Copy
                                    </button>
                                  </dd>
                                </div>
                              )}
                            </dl>
                          ) : p.details_via_email ? (
                            <span className="text-amber-800">
                              The doctor chose to <strong>email their bank details</strong> to contact@thefamilymedic.com
                              — check that inbox before transferring.
                            </span>
                          ) : (
                            <span className="text-amber-800">
                              No bank details on file for this doctor. Ask them to add details or email them to you.
                            </span>
                          )}
                          {snap && recentlyChanged && (
                            <p className="mt-2 text-xs font-medium text-amber-700">
                              ⚠ The doctor&rsquo;s payout details were changed on {fmt(changed)}. If this is unexpected,
                              confirm with them before transferring.
                            </p>
                          )}
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="flex gap-2">
                            <input
                              value={refDraft[p.id] ?? ""}
                              onChange={(e) => setRefDraft({ ...refDraft, [p.id]: e.target.value })}
                              placeholder="Transfer reference (optional)"
                              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button
                              disabled={busy === p.id}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Mark ${money(p.amount)} to ${doctorName(p.doctor_id)} as paid? Only do this after the transfer has been made.`
                                  )
                                ) {
                                  run(p.id, () =>
                                    supabase!.rpc("admin_mark_payout_paid", {
                                      p_payout_id: p.id,
                                      p_reference: refDraft[p.id] ?? null,
                                    })
                                  );
                                }
                              }}
                              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                            >
                              Mark paid
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <input
                              value={noteDraft[p.id] ?? ""}
                              onChange={(e) => setNoteDraft({ ...noteDraft, [p.id]: e.target.value })}
                              placeholder="Reason, if declining"
                              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button
                              disabled={busy === p.id}
                              onClick={() => {
                                if (window.confirm("Decline this payout? The amount returns to the doctor's available balance.")) {
                                  run(p.id, () =>
                                    supabase!.rpc("admin_reject_payout", {
                                      p_payout_id: p.id,
                                      p_note: noteDraft[p.id] ?? null,
                                    })
                                  );
                                }
                              }}
                              className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Balances */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Doctor balances</h2>
              <p className="mt-1 text-xs text-slate-500">
                &ldquo;Available&rdquo; has cleared the {settings?.hold_days ?? 3}-day hold and can be requested.
                &ldquo;Clearing&rdquo; is earned but still waiting out the hold or an open consultation.
              </p>
              {balances === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : balanceRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No earnings recorded yet. (Test payments don&rsquo;t count until you switch them on below, and real
                  ones only count once the consultation is completed.)
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3">Doctor</th>
                        <th className="px-4 py-3 text-right">Available</th>
                        <th className="px-4 py-3 text-right">Clearing</th>
                        <th className="px-4 py-3 text-right">Paid so far</th>
                        <th className="px-4 py-3">Bank details</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {balanceRows.map((b) => (
                        <tr key={b.doctor_id} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-4 py-3 font-medium text-slate-900">{b.full_name}</td>
                          <td className="px-4 py-3 text-right font-semibold text-teal-800">{money(b.available)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{money(b.upcoming)}</td>
                          <td className="px-4 py-3 text-right text-slate-700">{money(b.paid_total)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{b.has_bank_details ? "Saved" : "Not saved"}</td>
                          <td className="px-4 py-3 text-right">
                            {b.open_payout_id ? (
                              <span className="text-xs text-amber-700">Payout open</span>
                            ) : b.available > 0 ? (
                              <button
                                disabled={busy === `gen-${b.doctor_id}`}
                                onClick={() => {
                                  if (window.confirm(`Create a payout of ${money(b.available)} for ${b.full_name}?`)) {
                                    run(`gen-${b.doctor_id}`, () =>
                                      supabase!.rpc("admin_generate_payout", {
                                        p_doctor_id: b.doctor_id,
                                        p_ignore_hold: false,
                                      })
                                    );
                                  }
                                }}
                                className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                              >
                                Create payout
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Settings */}
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Payout rules</h2>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600">Hold after completion (days)</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={holdDraft}
                    onChange={(e) => setHoldDraft(e.target.value)}
                    className="mt-1 w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Minimum payout (PKR)</label>
                  <input
                    type="number"
                    min={0}
                    value={minDraft}
                    onChange={(e) => setMinDraft(e.target.value)}
                    className="mt-1 w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  onClick={() => saveSettings()}
                  disabled={savingSettings}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {savingSettings ? "Saving…" : "Save"}
                </button>
                {settingsNote && <span className="text-xs text-teal-700">{settingsNote}</span>}
              </div>
              <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings?.include_test_payments ?? false}
                  onChange={(e) => saveSettings({ include_test_payments: e.target.checked })}
                  className="mt-1"
                />
                <span>
                  Count test (sandbox) payments as earnings
                  <span className="block text-xs text-slate-500">
                    Off by default. Turn on only to try this page before go-live, and turn it off again afterwards.
                    Real (production) payments always count.
                  </span>
                </span>
              </label>
            </section>

            {/* History */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Payout history</h2>
              {payouts === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : closed.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">Nothing paid or cancelled yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {closed.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{doctorName(p.doctor_id)}</div>
                        <div className="text-xs text-slate-500">
                          {p.consultation_count} consultation{p.consultation_count === 1 ? "" : "s"} · {money(p.amount)}
                          {p.status === "paid" && ` · paid ${fmt(p.paid_at)}`}
                          {p.transfer_reference && ` · ref ${p.transfer_reference}`}
                          {p.status === "cancelled" && p.note && ` · ${p.note}`}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.status === "paid" ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {p.status === "paid" ? "Paid" : "Cancelled"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
