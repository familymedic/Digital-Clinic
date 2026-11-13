"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import PosterMaker from "@/components/locator/PosterMaker";
import { supabase } from "@/lib/supabaseClient";
import { CATEGORY_LABEL } from "@/lib/locator";
import PlaceCard from "./PlaceCard";
import PlaceForm, { formFromPlace } from "./PlaceForm";
import { REASON_LABEL, fmtDate, rs, waNumber, type Fee, type Payment, type Place, type ReportRow, type Summary } from "./types";

// Admin "Locator" (migrations 0095 + 0096). One screen for the whole business of the locator:
// the verification queue, adding places directly (with payment and receipt), live / awaiting
// payment / expired lists, reports, the fee table, usage numbers, and the waiting list.
// Everything goes through admin-only policies and functions.

interface WaitRow {
  id: string;
  city: string;
  contact: string;
  interest: string;
  created_at: string;
}

type View = "overview" | "review" | "live" | "unpaid" | "expired" | "hidden" | "reports" | "payments" | "fees" | "waitlist" | "poster";

export default function AdminLocator() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [wait, setWait] = useState<WaitRow[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [payments, setPayments] = useState<(Payment & { locator_places: { name: string } | null })[]>([]);
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<ReturnType<typeof formFromPlace> | null>(null);
  const [catFilter, setCatFilter] = useState<"all" | "doctor" | "pharmacy" | "therapy" | "autism">("all");
  const [feeEdits, setFeeEdits] = useState<Record<string, Partial<Fee>>>({});
  const [feeMsg, setFeeMsg] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!supabase) return;
    const [s, p, w, f, r, pay] = await Promise.all([
      supabase.rpc("locator_admin_summary"),
      supabase.from("locator_places").select("*").order("created_at", { ascending: false }).limit(1500),
      supabase.from("locator_waitlist").select("*").order("created_at", { ascending: false }).limit(2000),
      supabase.from("locator_fees").select("*").order("sort_order"),
      supabase.from("locator_reports").select("*, locator_places(name, area)").order("created_at", { ascending: false }).limit(300),
      supabase.from("locator_payments").select("*, locator_places(name)").eq("status", "succeeded").order("paid_at", { ascending: false }).limit(300),
    ]);
    const err = s.error || p.error || w.error || f.error || r.error || pay.error;
    if (err) {
      setError(
        /does not exist|schema cache|locator_/i.test(err.message)
          ? "The Locator needs migrations 0095 and 0096 to be run once in Supabase. (" + err.message + ")"
          : err.message
      );
      setPlaces([]);
      return;
    }
    setError(null);
    setSummary(s.data as Summary);
    setPlaces(
      (p.data ?? []).map((x) => ({ ...x, lat: Number(x.lat), lng: Number(x.lng), proof_paths: x.proof_paths ?? [] })) as Place[]
    );
    setWait((w.data ?? []) as WaitRow[]);
    setFees(((f.data ?? []) as Fee[]).map((x) => ({ ...x, fee_pkr: Number(x.fee_pkr) })));
    setReports((r.data ?? []) as unknown as ReportRow[]);
    setPayments((pay.data ?? []) as unknown as (Payment & { locator_places: { name: string } | null })[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: Place["status"]) {
    if (!supabase) return;
    setBusy(id);
    const { error: e } = await supabase.from("locator_places").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  }

  async function remove(p: Place) {
    if (!supabase) return;
    if (!window.confirm(`Delete "${p.name}" permanently, with its payments and counters? This cannot be undone. (Use Hide if you may want it back.)`)) return;
    setBusy(p.id);
    const { error: e } = await supabase.from("locator_places").delete().eq("id", p.id);
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  }

  async function toggleLive() {
    if (!supabase || !summary) return;
    const next = !summary.is_live;
    if (!next && !window.confirm("Switch the public locator OFF? Visitors will see a 'taking a short break' message.")) return;
    const { error: e } = await supabase.from("locator_settings").update({ is_live: next, updated_at: new Date().toISOString() }).eq("id", 1);
    if (e) return setError(e.message);
    await load();
  }

  async function reportDone(id: string, done: boolean) {
    if (!supabase) return;
    const { error: e } = await supabase.from("locator_reports").update({ status: done ? "done" : "open" }).eq("id", id);
    if (e) return setError(e.message);
    await load();
  }

  async function reportDelete(id: string) {
    if (!supabase) return;
    const { error: e } = await supabase.from("locator_reports").delete().eq("id", id);
    if (e) return setError(e.message);
    await load();
  }

  async function purgeDrafts() {
    if (!supabase) return;
    if (!window.confirm("Delete applications that were never paid and are older than 30 days? Paid places are never touched.")) return;
    const { data, error: e } = await supabase.rpc("locator_admin_purge_drafts");
    if (e) return setError(e.message);
    setFeeMsg(`${data ?? 0} old unpaid application(s) removed.`);
    await load();
  }

  async function saveFee(kind: string) {
    if (!supabase) return;
    const patch = feeEdits[kind];
    if (!patch) return;
    const row: Partial<Fee> = {};
    if (patch.fee_pkr !== undefined) {
      const n = Math.round(Number(patch.fee_pkr));
      if (!Number.isFinite(n) || n < 0 || n > 1000000) return setFeeMsg("Fee must be a number between 0 and 1,000,000.");
      row.fee_pkr = n;
    }
    if (patch.requires_verification !== undefined) row.requires_verification = patch.requires_verification;
    if (patch.accepts_applications !== undefined) row.accepts_applications = patch.accepts_applications;
    const { error: e } = await supabase.from("locator_fees").update(row).eq("kind", kind);
    if (e) return setFeeMsg(e.message);
    setFeeEdits((m) => {
      const c = { ...m };
      delete c[kind];
      return c;
    });
    setFeeMsg("Saved. New applications use it straight away; people who already applied pay the new amount too.");
    await load();
  }

  function downloadWaitlist() {
    const lines = ["city,contact,interest,date"].concat(
      wait.map((w) => [w.city, w.contact, w.interest, w.created_at.slice(0, 10)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locator-waitlist.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadPayments() {
    const lines = ["receipt_no,paid_at,place,amount,method,months,reference"].concat(
      payments.map((x) =>
        [x.receipt_no ?? "", x.paid_at?.slice(0, 10) ?? "", x.locator_places?.name ?? "", x.amount, x.method, x.months, x.reference ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locator-payments.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const all = places ?? [];
  const isPaid = (p: Place) => p.paid_until !== null && new Date(p.paid_until).getTime() > now;
  const paidKinds = (p: Place) => p.category !== "autism";
  const lists: Record<string, Place[]> = {
    review: all.filter((p) => p.status === "pending"),
    live: all.filter((p) => p.status === "approved" && (!paidKinds(p) || isPaid(p))),
    unpaid: all.filter((p) => p.status === "approved" && paidKinds(p) && p.paid_until === null),
    expired: all.filter((p) => p.status === "approved" && paidKinds(p) && p.paid_until !== null && !isPaid(p)),
    hidden: all.filter((p) => p.status === "hidden"),
  };
  const filtered = (v: string) => lists[v].filter((p) => catFilter === "all" || p.category === catFilter);
  const openReports = reports.filter((r) => r.status === "open");
  const ev7 = summary?.events_7d ?? {};
  const ev30 = summary?.events_30d ?? {};

  const tabs: { key: View; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "review", label: `To review (${lists.review.length})` },
    { key: "unpaid", label: `Awaiting payment (${lists.unpaid.length})` },
    { key: "live", label: `Live (${lists.live.length})` },
    { key: "expired", label: `Expired (${lists.expired.length})` },
    { key: "hidden", label: `Hidden (${lists.hidden.length})` },
    { key: "reports", label: `Reports (${openReports.length})` },
    { key: "payments", label: "Payments" },
    { key: "fees", label: "Fees" },
    { key: "waitlist", label: `Waiting list (${wait.length})` },
    { key: "poster", label: "Invite poster" },
  ];

  return (
    <AdminGuard title="Locator">
      {() => (
        <div>
          <PageHeader title="Locator" subtitle="Karachi and Hyderabad: verify and register workplaces, take payments, and see how the locator is used." />
          <div className="mx-auto max-w-4xl space-y-5 px-4 py-10 sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
                ← Back to admin
              </Link>
              <Link href="/locator" target="_blank" className="text-sm font-medium text-teal-700 underline underline-offset-2">
                Open the public locator
              </Link>
              <button onClick={load} className="ml-auto text-sm font-medium text-teal-700 underline underline-offset-2">
                Refresh
              </button>
            </div>

            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

            <div>
              <button
                onClick={() => {
                  setEditing(null);
                  setFormKey((k) => k + 1);
                  setFormOpen((o) => (editing ? true : !o));
                }}
                data-testid="admin-add-place"
                className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800"
              >
                {formOpen && !editing ? "Close form" : "+ Add a place directly"}
              </button>
            </div>

            {formOpen && (
              <PlaceForm
                key={formKey}
                fees={fees}
                initial={editing}
                onClose={() => {
                  setFormOpen(false);
                  setEditing(null);
                }}
                onSaved={load}
              />
            )}

            <div className="flex flex-wrap gap-2 text-xs" role="tablist" aria-label="Locator sections">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={view === t.key}
                  onClick={() => setView(t.key)}
                  data-testid={`admin-tab-${t.key}`}
                  className={`rounded-full px-3 py-1.5 font-medium ${view === t.key ? "bg-teal-700 text-white" : "bg-[#e6f1ed] text-ink-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {places === null && <p className="text-sm text-ink-500">Loading…</p>}

            {/* ------------------------------------------------ overview */}
            {view === "overview" && summary && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Live: doctors & clinics", summary.places.live_doctor],
                    ["Live: pharmacies", summary.places.live_pharmacy ?? 0],
                    ["Live: therapy & rehab", summary.places.live_therapy],
                    ["Live: autism-aware", summary.places.live_autism],
                    ["To review", summary.places.pending],
                    ["Awaiting payment", summary.places.awaiting_payment],
                    ["Expiring in 30 days", summary.places.expiring_30d],
                    ["Revenue, 30 days", rs(summary.revenue_30d)],
                    ["Revenue, all time", rs(summary.revenue_total)],
                  ].map(([label, v]) => (
                    <div key={String(label)} className="rounded-2xl border border-[#d7e7e2] bg-white p-4">
                      <div className="text-xl font-extrabold text-ink-900">{v}</div>
                      <div className="mt-1 text-xs font-semibold text-ink-500">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-[#d7e7e2] bg-white p-4 text-sm text-ink-700">
                  <p className="font-bold text-ink-900">Usage (anonymous: no locations or names stored)</p>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-500">
                        <th className="py-1 pr-3 font-semibold">&nbsp;</th>
                        <th className="py-1 pr-3 font-semibold">Last 7 days</th>
                        <th className="py-1 font-semibold">Last 30 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Searches", "search"],
                        ["Found something", "results"],
                        ["Found nothing", "empty"],
                        ["Directions taps", "directions_tap"],
                        ["Call taps", "call_tap"],
                        ["Book online taps", "book_tap"],
                        ["Outside our cities", "coming_soon"],
                        ["Location blocked", "gps_denied"],
                        ["Suggestions", "suggest"],
                        ["Workplace applications", "apply"],
                        ["Payments started", "pay_start"],
                        ["Payments completed", "paid"],
                        ["Problem reports", "report"],
                      ].map(([label, key]) => (
                        <tr key={key} className="border-t border-[#e8f1ee]">
                          <td className="py-1.5 pr-3 font-semibold text-ink-900">{label}</td>
                          <td className="py-1.5 pr-3">{ev7[key] ?? 0}</td>
                          <td className="py-1.5">{ev30[key] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-2xl border border-[#d7e7e2] bg-white p-4 text-sm text-ink-700">
                  <p className="font-bold text-ink-900">By tab, last 30 days</p>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-500">
                        <th className="py-1 pr-3 font-semibold">Tab</th>
                        <th className="py-1 pr-3 font-semibold">Searches</th>
                        <th className="py-1 pr-3 font-semibold">Found nothing</th>
                        <th className="py-1 pr-3 font-semibold">Call taps</th>
                        <th className="py-1 font-semibold">Book taps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["doctor", "pharmacy", "therapy", "autism"] as const).map((c) => {
                        const t = summary.by_tab_30d[c] ?? {};
                        return (
                          <tr key={c} className="border-t border-[#e8f1ee]">
                            <td className="py-1.5 pr-3 font-semibold text-ink-900">{CATEGORY_LABEL[c]}</td>
                            <td className="py-1.5 pr-3">{t.search ?? 0}</td>
                            <td className="py-1.5 pr-3">{t.empty ?? 0}</td>
                            <td className="py-1.5 pr-3">{t.call_tap ?? 0}</td>
                            <td className="py-1.5">{t.book_tap ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-ink-500">Directions taps are counted per place (see below) because they pass through our link.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#d7e7e2] bg-white p-4 text-sm text-ink-700">
                    <p className="font-bold text-ink-900">Areas people search from (30 days)</p>
                    {summary.top_areas_30d.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-500">No data yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {summary.top_areas_30d.map((a) => (
                          <li key={a.area} className="flex justify-between gap-2">
                            <span>{a.area}</span>
                            <span>
                              {a.searches} searches{a.empty > 0 && <span className="text-amber-700"> · {a.empty} found nothing</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-ink-500">Lots of &quot;found nothing&quot; in an area is where to recruit next.</p>
                  </div>
                  <div className="rounded-2xl border border-[#d7e7e2] bg-white p-4 text-sm text-ink-700">
                    <p className="font-bold text-ink-900">Most used places (30 days)</p>
                    {summary.top_places_30d.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-500">No data yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {summary.top_places_30d.map((x) => (
                          <li key={x.id} className="flex justify-between gap-2">
                            <span className="truncate">{x.name}</span>
                            <span className="flex-none">
                              seen {x.shown} · dir {x.directions} · call {x.call}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d7e7e2] bg-white p-4">
                  <p className="text-sm text-ink-700">
                    Public locator is <strong className={summary.is_live ? "text-teal-700" : "text-red-700"}>{summary.is_live ? "ON" : "OFF"}</strong>.
                  </p>
                  <button
                    onClick={toggleLive}
                    className={`rounded-full px-4 py-2 text-sm font-extrabold ${
                      summary.is_live ? "border border-red-300 text-red-700 hover:bg-red-50" : "bg-teal-700 text-white hover:bg-teal-800"
                    }`}
                  >
                    {summary.is_live ? "Switch off" : "Switch on"}
                  </button>
                </div>
              </div>
            )}

            {/* ------------------------------------------------ place lists */}
            {(view === "review" || view === "live" || view === "unpaid" || view === "expired" || view === "hidden") && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="text-xs text-ink-500">
                    {view === "review" && "Owner applications waiting for a document check, and visitor suggestions waiting for approval."}
                    {view === "live" && "Visible to the public right now (paid listings, and free autism-aware places)."}
                    {view === "unpaid" && "Approved but not yet paid, so not visible to the public."}
                    {view === "expired" && "The paid year ended, so they are no longer shown. Record a renewal to bring them back."}
                    {view === "hidden" && "Rejected or hidden by you."}
                  </p>
                  <select
                    value={catFilter}
                    onChange={(e) => setCatFilter(e.target.value as typeof catFilter)}
                    className="ml-auto rounded-full border border-[#cfe0da] bg-white px-3 py-1 text-xs font-medium"
                    aria-label="Filter by list"
                  >
                    <option value="all">All lists</option>
                    <option value="doctor">{CATEGORY_LABEL.doctor}</option>
                    <option value="pharmacy">{CATEGORY_LABEL.pharmacy}</option>
                    <option value="therapy">{CATEGORY_LABEL.therapy}</option>
                    <option value="autism">{CATEGORY_LABEL.autism}</option>
                  </select>
                </div>
                {view === "unpaid" && lists.unpaid.length > 0 && (
                  <button onClick={purgeDrafts} className="text-xs font-bold text-red-700 underline">
                    Remove unpaid applications older than 30 days
                  </button>
                )}
                {filtered(view).length === 0 ? (
                  <p className="text-sm text-ink-500">{view === "review" ? "Nothing waiting for review. All caught up." : "Nothing here yet."}</p>
                ) : (
                  <ul className="space-y-3">
                    {filtered(view).map((p) => (
                      <PlaceCard
                        key={p.id}
                        p={p}
                        fees={fees}
                        busy={busy === p.id}
                        onStatus={setStatus}
                        onEdit={(pl) => {
                          setEditing(formFromPlace(pl));
                          setFormKey((k) => k + 1);
                          setFormOpen(true);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        onDelete={remove}
                        onChanged={load}
                        onError={setError}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ------------------------------------------------ reports */}
            {view === "reports" && (
              <div className="space-y-3">
                {reports.length === 0 ? (
                  <p className="text-sm text-ink-500">No problem reports yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {reports.map((r) => (
                      <li key={r.id} className={`rounded-2xl border bg-white p-3 text-sm ${r.status === "open" ? "border-amber-300" : "border-[#d7e7e2] opacity-70"}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-extrabold text-ink-900">{r.locator_places?.name ?? "(deleted place)"}</p>
                            <p className="text-xs text-ink-500">
                              {REASON_LABEL[r.reason] ?? r.reason} · {fmtDate(r.created_at)}
                              {r.locator_places?.area ? ` · ${r.locator_places.area}` : ""}
                            </p>
                            {r.note && <p className="mt-1 text-ink-700">&ldquo;{r.note}&rdquo;</p>}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {r.status === "open" ? (
                              <button onClick={() => reportDone(r.id, true)} className="rounded-full bg-teal-700 px-3 py-1.5 font-bold text-white">
                                Mark done
                              </button>
                            ) : (
                              <button onClick={() => reportDone(r.id, false)} className="rounded-full border border-[#cfe0da] px-3 py-1.5 font-bold text-ink-700">
                                Reopen
                              </button>
                            )}
                            {r.status === "open" && r.locator_places && (
                              <button
                                onClick={async () => {
                                  await setStatus(r.place_id, "hidden");
                                  await reportDone(r.id, true);
                                }}
                                className="rounded-full border border-amber-400 px-3 py-1.5 font-bold text-amber-800"
                              >
                                Hide the place
                              </button>
                            )}
                            <button onClick={() => reportDelete(r.id)} className="rounded-full border border-red-300 px-3 py-1.5 font-bold text-red-700">
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ------------------------------------------------ payments */}
            {view === "payments" && (
              <div className="space-y-3">
                {payments.length === 0 ? (
                  <p className="text-sm text-ink-500">No payments recorded yet.</p>
                ) : (
                  <>
                    <button onClick={downloadPayments} className="text-sm font-bold text-teal-700 underline underline-offset-2">
                      Download as CSV
                    </button>
                    <ul className="space-y-2">
                      {payments.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d7e7e2] bg-white p-3 text-sm">
                          <span>
                            <strong>#{x.receipt_no}</strong> · {x.locator_places?.name ?? "(deleted place)"}
                          </span>
                          <span className="text-xs text-ink-700">
                            {rs(x.amount)} · {x.method} · {x.months} mo · {x.paid_at ? fmtDate(x.paid_at) : ""}
                            {x.reference ? ` · ${x.reference}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ------------------------------------------------ fees */}
            {view === "fees" && (
              <div className="space-y-3">
                <p className="text-sm text-ink-700">
                  Yearly fee per type of workplace. These are placeholders until you finalize them. Turning verification off makes that type pay without a document check (as for pharmacies).
                </p>
                {feeMsg && <p className="rounded-xl bg-teal-50 p-3 text-sm font-semibold text-teal-900">{feeMsg}</p>}
                <ul className="space-y-2">
                  {fees.map((f) => {
                    const e = feeEdits[f.kind] ?? {};
                    const dirty = Object.keys(e).length > 0;
                    return (
                      <li key={f.kind} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#d7e7e2] bg-white p-3 text-sm">
                        <span className="min-w-40 flex-1 font-extrabold text-ink-900">{f.label}</span>
                        <label className="flex items-center gap-1 text-xs font-semibold">
                          PKR
                          <input
                            value={e.fee_pkr !== undefined ? String(e.fee_pkr) : String(f.fee_pkr)}
                            onChange={(ev) => setFeeEdits((m) => ({ ...m, [f.kind]: { ...m[f.kind], fee_pkr: ev.target.value as unknown as number } }))}
                            inputMode="numeric"
                            className="w-24 rounded-xl border border-[#cfe0da] px-2 py-1.5"
                            aria-label={`${f.label} yearly fee`}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs font-semibold">
                          <input
                            type="checkbox"
                            checked={e.requires_verification ?? f.requires_verification}
                            onChange={(ev) => setFeeEdits((m) => ({ ...m, [f.kind]: { ...m[f.kind], requires_verification: ev.target.checked } }))}
                          />
                          Verify first
                        </label>
                        <label className="flex items-center gap-1 text-xs font-semibold">
                          <input
                            type="checkbox"
                            checked={e.accepts_applications ?? f.accepts_applications}
                            onChange={(ev) => setFeeEdits((m) => ({ ...m, [f.kind]: { ...m[f.kind], accepts_applications: ev.target.checked } }))}
                          />
                          Open for applications
                        </label>
                        <button
                          disabled={!dirty}
                          onClick={() => saveFee(f.kind)}
                          className="rounded-full bg-teal-700 px-3.5 py-1.5 text-xs font-extrabold text-white disabled:opacity-40"
                        >
                          Save
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ------------------------------------------------ waiting list */}
            {view === "waitlist" && (
              <div className="space-y-3">
                {summary && summary.waitlist_cities.length > 0 && (
                  <p className="text-sm text-ink-700">Top cities: {summary.waitlist_cities.map((c) => `${c.city} (${c.n})`).join(", ")}</p>
                )}
                {wait.length === 0 ? (
                  <p className="text-sm text-ink-500">Nobody outside our cities has signed up yet.</p>
                ) : (
                  <>
                    <button onClick={downloadWaitlist} className="text-sm font-bold text-teal-700 underline underline-offset-2">
                      Download as CSV
                    </button>
                    <ul className="space-y-2">
                      {wait.map((w) => {
                        const wa = waNumber(w.contact);
                        return (
                          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#d7e7e2] bg-white p-3 text-sm">
                            <span>
                              <strong>{w.city}</strong> · {w.contact} · <span className="text-ink-500">{w.interest}</span>
                            </span>
                            <span className="flex items-center gap-3 text-xs">
                              <span className="text-ink-400">{w.created_at.slice(0, 10)}</span>
                              {!w.contact.includes("@") && wa && (
                                <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="font-bold text-teal-700 underline">
                                  WhatsApp
                                </a>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* ------------------------------------------------ invite poster */}
            {view === "poster" && (
              <div className="rounded-2xl border border-[#d7e7e2] bg-white p-4">
                <p className="mb-3 text-sm text-ink-700">
                  A poster that invites clinics, pharmacies and therapy centres to list themselves. Post it on Facebook, WhatsApp groups, or print it for visits.
                </p>
                <PosterMaker mode="invite" />
              </div>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
