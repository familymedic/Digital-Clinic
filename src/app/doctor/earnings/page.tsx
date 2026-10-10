"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Doctor earnings and payouts (2026-10-05, physician request). Everything
// here is read through / written by the database functions in 0063:
//   - doctor_earnings_summary() / doctor_earnings_lines(): what the doctor
//     has earned AFTER the platform's share, split into what can be
//     requested now, what is still waiting out the hold period, what is
//     in a payout already requested, and what has been paid. Patient
//     identities never appear here.
//   - request_payout(): the server (never this page) works out the amount
//     and claims those consultations in one locked step.
// The doctor's own bank/wallet details are stored in doctor_payout_details
// (only they and admins can read them).

interface Summary {
  available: number;
  available_count: number;
  upcoming: number;
  in_progress: number;
  paid_total: number;
  lifetime: number;
  min_payout: number;
  hold_days: number;
  open_payout: {
    id: string;
    status: "requested" | "pending";
    amount: number;
    consultation_count: number;
    requested_at: string | null;
    details_via_email: boolean;
    source: string;
  } | null;
}

interface Line {
  occurred_at: string;
  delivery_mode: string | null;
  fee: number;
  platform_share: number | null;
  doctor_share: number | null;
  state: "available" | "in_hold" | "awaiting_completion" | "requested" | "paid";
}

interface PayoutRow {
  id: string;
  status: "requested" | "pending" | "paid" | "cancelled";
  amount: number;
  consultation_count: number;
  requested_at: string | null;
  created_at: string;
  paid_at: string | null;
  transfer_reference: string | null;
  note: string | null;
}

interface Details {
  account_title: string | null;
  bank_name: string | null;
  account_number: string | null;
  wallet_provider: "jazzcash" | "easypaisa" | null;
  wallet_number: string | null;
}

const money = (n: number | null | undefined) => `PKR ${Number(n ?? 0).toLocaleString()}`;
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric" })
    : "—";

const STATE_LABEL: Record<Line["state"], { text: string; cls: string }> = {
  available: { text: "Available", cls: "bg-teal-50 text-teal-800" },
  in_hold: { text: "Clearing", cls: "bg-amber-50 text-amber-800" },
  awaiting_completion: { text: "Consultation open", cls: "bg-[var(--background)] text-ink-500" },
  requested: { text: "In payout request", cls: "bg-blue-50 text-blue-800" },
  paid: { text: "Paid", cls: "bg-emerald-50 text-emerald-800" },
};

function maskAccount(n: string | null): string {
  if (!n) return "";
  const clean = n.replace(/\s+/g, "");
  return clean.length <= 4 ? clean : `${"•".repeat(Math.max(clean.length - 4, 4))}${clean.slice(-4)}`;
}

export default function DoctorEarnings() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [details, setDetails] = useState<Details | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bank details form.
  const [editing, setEditing] = useState(false);
  const [accountTitle, setAccountTitle] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [walletProvider, setWalletProvider] = useState<"" | "jazzcash" | "easypaisa">("");
  const [walletNumber, setWalletNumber] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsNote, setDetailsNote] = useState<string | null>(null);

  // Request.
  const [viaEmail, setViaEmail] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);
    const [sumRes, linesRes, payoutsRes, detailsRes] = await Promise.all([
      supabase.rpc("doctor_earnings_summary"),
      supabase.rpc("doctor_earnings_lines", { p_limit: 200 }),
      supabase
        .from("doctor_payouts")
        .select("id, status, amount, consultation_count, requested_at, created_at, paid_at, transfer_reference, note")
        .eq("doctor_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("doctor_payout_details")
        .select("account_title, bank_name, account_number, wallet_provider, wallet_number")
        .eq("doctor_id", session.user.id)
        .maybeSingle(),
    ]);
    if (sumRes.error) return setLoadError(sumRes.error.message);
    if (linesRes.error) return setLoadError(linesRes.error.message);
    setSummary(sumRes.data as Summary);
    setLines(linesRes.data as Line[]);
    setPayouts(payoutsRes.error ? [] : (payoutsRes.data as PayoutRow[]));
    const d = detailsRes.error ? null : (detailsRes.data as Details | null);
    setDetails(d);
    if (d) {
      setAccountTitle(d.account_title ?? "");
      setBankName(d.bank_name ?? "");
      setAccountNumber(d.account_number ?? "");
      setWalletProvider(d.wallet_provider ?? "");
      setWalletNumber(d.wallet_number ?? "");
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDetails() {
    if (!supabase || !session) return;
    setDetailsError(null);
    setDetailsNote(null);
    const hasBank = accountTitle.trim() && bankName.trim() && accountNumber.trim();
    const hasWallet = walletProvider && walletNumber.trim();
    if (!hasBank && !hasWallet) {
      setDetailsError("Please enter bank details (account title, bank and account number/IBAN) or a JazzCash/Easypaisa number.");
      return;
    }
    if (accountNumber.trim() && !/^[A-Za-z0-9 -]{6,40}$/.test(accountNumber.trim())) {
      setDetailsError("The account number / IBAN should be 6–40 letters, numbers, spaces or dashes.");
      return;
    }
    if (walletNumber.trim() && !/^[0-9+ -]{9,20}$/.test(walletNumber.trim())) {
      setDetailsError("The wallet number should contain digits only, e.g. 0300 1234567.");
      return;
    }
    setSavingDetails(true);
    const { error } = await supabase.from("doctor_payout_details").upsert(
      {
        doctor_id: session.user.id,
        account_title: accountTitle.trim() || null,
        bank_name: bankName.trim() || null,
        account_number: accountNumber.trim() || null,
        wallet_provider: walletProvider || null,
        wallet_number: walletNumber.trim() || null,
      },
      { onConflict: "doctor_id" }
    );
    setSavingDetails(false);
    if (error) {
      setDetailsError(error.message);
      return;
    }
    setEditing(false);
    setDetailsNote("Saved. These details are only visible to you and the clinic admin.");
    load();
  }

  async function requestPayout() {
    if (!supabase) return;
    setRequesting(true);
    setRequestError(null);
    setRequestNote(null);
    const { error } = await supabase.rpc("request_payout", { p_via_email: viaEmail && !details });
    setRequesting(false);
    if (error) {
      setRequestError(error.message);
      return;
    }
    setRequestNote("Payout requested. The clinic has been notified and will transfer it to you.");
    load();
  }

  async function cancelRequest() {
    if (!supabase || !summary?.open_payout) return;
    setCancelling(true);
    setRequestError(null);
    const { error } = await supabase.rpc("cancel_payout_request", { p_payout_id: summary.open_payout.id });
    setCancelling(false);
    if (error) {
      setRequestError(error.message);
      return;
    }
    setRequestNote("Request cancelled — the amount is back in your available balance.");
    load();
  }

  const shellProps = { active: "earnings" as const };

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell {...shellProps}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
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

  const shell = { ...shellProps, doctorName: profile.full_name, onSignOut: signOut, doctorId: profile.id };

  if (loadError) {
    return (
      <DoctorShell {...shell}>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">Earnings &amp; payouts</h1>
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load your earnings: {loadError}
        </div>
      </DoctorShell>
    );
  }
  if (!summary || !lines || !payouts || details === undefined) {
    return (
      <DoctorShell {...shell}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  const open = summary.open_payout;
  const belowMin = summary.available < summary.min_payout;
  const noDestination = !details && !viaEmail;
  const canRequest = !open && summary.available > 0 && !belowMin && !noDestination;

  return (
    <DoctorShell {...shell}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">Earnings &amp; payouts</h1>
      <p className="mt-1 text-sm text-ink-500">
        What you&rsquo;ve earned after the platform&rsquo;s share, and your payouts. Earnings from a
        completed consultation become available to request {summary.hold_days} day
        {summary.hold_days === 1 ? "" : "s"} after it&rsquo;s completed.
      </p>

      {/* Balance cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-800">Available to request</div>
          <div className="mt-2 text-2xl font-extrabold text-teal-900">{money(summary.available)}</div>
          <div className="mt-1 text-xs text-teal-800">
            {summary.available_count} consultation{summary.available_count === 1 ? "" : "s"}
          </div>
        </div>
        <div className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Still clearing</div>
          <div className="mt-2 text-2xl font-extrabold text-ink-900">{money(summary.upcoming)}</div>
          <div className="mt-1 text-xs text-ink-500">Open consultations and the {summary.hold_days}-day hold</div>
        </div>
        <div className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">In a payout request</div>
          <div className="mt-2 text-2xl font-extrabold text-ink-900">{money(summary.in_progress)}</div>
          <div className="mt-1 text-xs text-ink-500">Requested, not yet transferred</div>
        </div>
        <div className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Paid to you so far</div>
          <div className="mt-2 text-2xl font-extrabold text-ink-900">{money(summary.paid_total)}</div>
          <div className="mt-1 text-xs text-ink-500">Lifetime earned: {money(summary.lifetime)}</div>
        </div>
      </div>

      {/* Request */}
      <section className="mt-6 rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <h2 className="text-sm font-bold text-ink-900">Request a payout</h2>

        {requestError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{requestError}</div>
        )}
        {requestNote && (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{requestNote}</div>
        )}

        {open ? (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="font-semibold">
              {money(open.amount)} for {open.consultation_count} consultation{open.consultation_count === 1 ? "" : "s"} —
              waiting for transfer
            </div>
            <div className="mt-1 text-xs">
              {open.source === "doctor_request" ? "Requested" : "Prepared by the clinic"} on{" "}
              {fmtDate(open.requested_at)}.{" "}
              {open.details_via_email && "You chose to email your bank details to contact@thefamilymedic.com."}
            </div>
            {open.status === "requested" && (
              <button
                onClick={cancelRequest}
                disabled={cancelling}
                className="mt-3 text-xs font-semibold text-red-700 underline underline-offset-2 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel this request"}
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-500">
              The minimum payout is {money(summary.min_payout)}. Your available balance is{" "}
              <span className="font-semibold text-ink-900">{money(summary.available)}</span>.
            </p>
            {!details && (
              <label className="mt-3 flex items-start gap-2 text-xs text-ink-700">
                <input
                  type="checkbox"
                  checked={viaEmail}
                  onChange={(e) => setViaEmail(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I&rsquo;ll email my bank details to{" "}
                  <span className="font-semibold">contact@thefamilymedic.com</span> instead of saving them here.
                </span>
              </label>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={requestPayout}
                disabled={!canRequest || requesting}
                className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {requesting ? "Requesting…" : `Request payout of ${money(summary.available)}`}
              </button>
              {!canRequest && (
                <span className="text-xs text-amber-700">
                  {summary.available <= 0
                    ? "Nothing available yet."
                    : belowMin
                      ? `Available balance is below the ${money(summary.min_payout)} minimum.`
                      : "Save your bank details below, or tick the email option, first."}
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Bank details */}
      <section className="mt-6 rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink-900">Where to send your payouts</h2>
          {details && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
            >
              Change details
            </button>
          )}
        </div>
        {detailsNote && (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{detailsNote}</div>
        )}

        {details && !editing ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {details.account_number && (
              <>
                <div>
                  <dt className="text-xs text-ink-400">Account title</dt>
                  <dd className="font-semibold text-ink-900">{details.account_title}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Bank</dt>
                  <dd className="font-semibold text-ink-900">{details.bank_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Account number / IBAN</dt>
                  <dd className="font-semibold text-ink-900">{maskAccount(details.account_number)}</dd>
                </div>
              </>
            )}
            {details.wallet_number && (
              <div>
                <dt className="text-xs text-ink-400">
                  {details.wallet_provider === "jazzcash" ? "JazzCash" : "Easypaisa"} number
                </dt>
                <dd className="font-semibold text-ink-900">{details.wallet_number}</dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-ink-500">
              Only you and the clinic admin can see these. Prefer not to save them here? Tick the email option
              above and send them to contact@thefamilymedic.com instead.
            </p>
            {detailsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{detailsError}</div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-ink-700">Account title (name on the account)</label>
                <input
                  value={accountTitle}
                  onChange={(e) => setAccountTitle(e.target.value)}
                  maxLength={120}
                  className="mt-1 w-full rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-700">Bank name</label>
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  maxLength={120}
                  className="mt-1 w-full rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-ink-700">Account number or IBAN</label>
                <input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  maxLength={40}
                  placeholder="e.g. PK36SCBL0000001123456702"
                  className="mt-1 w-full rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-700">Or a mobile wallet (optional)</label>
                <select
                  value={walletProvider}
                  onChange={(e) => setWalletProvider(e.target.value as "" | "jazzcash" | "easypaisa")}
                  className="mt-1 w-full rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="easypaisa">Easypaisa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-700">Wallet number</label>
                <input
                  value={walletNumber}
                  onChange={(e) => setWalletNumber(e.target.value)}
                  maxLength={20}
                  placeholder="0300 1234567"
                  className="mt-1 w-full rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveDetails}
                disabled={savingDetails}
                className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingDetails ? "Saving…" : "Save details"}
              </button>
              {details && (
                <button
                  onClick={() => {
                    setEditing(false);
                    setDetailsError(null);
                    load();
                  }}
                  className="text-xs font-semibold text-ink-500 underline underline-offset-2"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-xs text-ink-400">
              If you change these details while a payout is waiting, the transfer uses the details as they were when
              you requested it. The clinic is also shown when details were recently changed.
            </p>
          </div>
        )}
      </section>

      {/* Payout history */}
      <section className="mt-7">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">Payout history</h2>
        {payouts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No payouts yet.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#dcebe6] bg-[var(--background)] text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-3">Requested</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Settled</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-[#dcebe6] last:border-b-0">
                    <td className="px-4 py-3 text-ink-700">{fmtDate(p.requested_at ?? p.created_at)}</td>
                    <td className="px-4 py-3 font-semibold text-ink-900">
                      {money(p.amount)}
                      <span className="ml-1 text-xs font-normal text-ink-400">
                        ({p.consultation_count} consult{p.consultation_count === 1 ? "" : "s"})
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          p.status === "paid"
                            ? "bg-emerald-50 text-emerald-800"
                            : p.status === "cancelled"
                              ? "bg-[var(--background)] text-ink-500"
                              : "bg-blue-50 text-blue-800"
                        }`}
                      >
                        {p.status === "paid" ? "Settled" : p.status === "cancelled" ? "Cancelled" : "Awaiting transfer"}
                      </span>
                      {p.status === "cancelled" && p.note && (
                        <div className="mt-1 text-xs text-ink-500">{p.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      {p.status === "paid" ? (
                        <>
                          {fmtDate(p.paid_at)}
                          {p.transfer_reference && (
                            <div className="text-xs text-ink-400">Ref: {p.transfer_reference}</div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Earnings lines */}
      <section className="mt-7">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">Your earnings, consultation by consultation</h2>
        {lines.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No paid consultations yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#dcebe6] bg-[var(--background)] text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Fee</th>
                  <th className="px-4 py-3 text-right">Platform fee</th>
                  <th className="px-4 py-3 text-right">Your share</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const st = STATE_LABEL[l.state];
                  return (
                    <tr key={i} className="border-b border-[#dcebe6] last:border-b-0">
                      <td className="px-4 py-3 text-ink-700">{fmtDate(l.occurred_at)}</td>
                      <td className="px-4 py-3 capitalize text-ink-700">{l.delivery_mode ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-ink-700">{money(l.fee)}</td>
                      <td className="px-4 py-3 text-right text-ink-500">− {money(l.platform_share)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-ink-900">{money(l.doctor_share)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-400">
          Refunded consultations don&rsquo;t earn anything and are left out. Payment-gateway fees are paid by the
          platform out of its own share — they are not deducted from yours.
        </p>
      </section>
    </DoctorShell>
  );
}
