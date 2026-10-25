"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildXlsx, downloadXlsx, type XlsxCell } from "@/lib/xlsxExport";

// Admin-only "Doctor views" report. Reads the aggregate numbers from the
// admin_doctor_view_stats() database function (migration 0074), which
// refuses anyone who is not an admin. Nothing here is shown to doctors or
// patients. Fail-soft: if 0074 has not been installed yet the section
// explains that instead of breaking the Business metrics page.

interface StatRow {
  doctor_id: string;
  full_name: string | null;
  specialty: string | null;
  shown: number;
  card_clicks: number;
  profile_views: number;
  unique_visitors: number;
  shared_card_views: number;
  book_clicks: number;
  paid_bookings: number;
}

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
] as const;

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function pctText(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

export default function AdminDoctorViews() {
  const [rangeKey, setRangeKey] = useState<string>("today");
  const [rows, setRows] = useState<StatRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== rangeKey;

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  const load = useCallback(async () => {
    if (!supabase) {
      setNote("Database connection is not configured.");
      setLoadedKey(rangeKey);
      return;
    }
    const to = new Date();
    // "Today" = since midnight (the admin's own clock, Pakistan time in practice).
    const midnight = new Date(to);
    midnight.setHours(0, 0, 0, 0);
    const from =
      range.key === "today"
        ? midnight
        : range.days > 0
          ? new Date(to.getTime() - range.days * 86400000)
          : new Date("2020-01-01T00:00:00Z");
    const { data, error } = await supabase.rpc("admin_doctor_view_stats", {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) {
      const missing =
        error.code === "PGRST202" ||
        error.code === "42883" ||
        /could not find the function/i.test(error.message ?? "");
      setRows(null);
      setNote(
        missing
          ? "Doctor views are not switched on yet — the database update (0074) has not been run."
          : `Could not load doctor views. ${error.message ?? ""}`.trim(),
      );
    } else {
      setNote(null);
      setRows(((data ?? []) as StatRow[]).map((r) => ({
        ...r,
        shown: Number(r.shown) || 0,
        card_clicks: Number(r.card_clicks) || 0,
        profile_views: Number(r.profile_views) || 0,
        unique_visitors: Number(r.unique_visitors) || 0,
        shared_card_views: Number(r.shared_card_views) || 0,
        book_clicks: Number(r.book_clicks) || 0,
        paid_bookings: Number(r.paid_bookings) || 0,
      })));
    }
    setLoadedKey(rangeKey);
  }, [range.days, range.key, rangeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const t = { shown: 0, card_clicks: 0, profile_views: 0, unique_visitors: 0, shared_card_views: 0, book_clicks: 0, paid_bookings: 0 };
    for (const r of rows ?? []) {
      t.shown += r.shown;
      t.card_clicks += r.card_clicks;
      t.profile_views += r.profile_views;
      t.unique_visitors += r.unique_visitors;
      t.shared_card_views += r.shared_card_views;
      t.book_clicks += r.book_clicks;
      t.paid_bookings += r.paid_bookings;
    }
    return t;
  }, [rows]);

  function exportExcel() {
    if (!rows) return;
    const header: XlsxCell[] = [
      "Doctor", "Specialty", "Card shown", "Card clicks", "Profile views", "Unique visitors",
      "Visits from shared cards", "Book clicks", "Paid bookings", "Card click-through", "Book rate (of profile views)",
    ];
    const body: XlsxCell[][] = rows.map((r) => [
      r.full_name ?? "(unnamed)", r.specialty ?? "", r.shown, r.card_clicks, r.profile_views, r.unique_visitors,
      r.shared_card_views, r.book_clicks, r.paid_bookings,
      { pct: ratio(r.card_clicks, r.shown) }, { pct: ratio(r.book_clicks, r.profile_views) },
    ]);
    const total: XlsxCell[] = [
      "TOTAL", "", totals.shown, totals.card_clicks, totals.profile_views, totals.unique_visitors,
      totals.shared_card_views, totals.book_clicks, totals.paid_bookings,
      { pct: ratio(totals.card_clicks, totals.shown) }, { pct: ratio(totals.book_clicks, totals.profile_views) },
    ];
    const today = new Date().toISOString().slice(0, 10);
    const about: XlsxCell[][] = [
      ["Family Medic — Doctor views"],
      ["Period", range.label],
      ["Generated", today],
      [""],
      ["Card shown", "Times the doctor's card was on screen in the doctors list (once per visitor per day)."],
      ["Card clicks", "Taps on the card that opened the doctor's profile."],
      ["Profile views", "Times the doctor's profile page was opened (once per visitor per 30 minutes)."],
      ["Unique visitors", "Different browsers that opened the profile."],
      ["Visits from shared cards", "Profile views that came from the doctor's shareable card link."],
      ["Book clicks", "Taps on a Book button from the list or the profile."],
      ["Paid bookings", "Consultations created in the period that were paid or completed."],
      [""],
      ["Note", "Counts are directional: ad blockers, cleared browsers and repeat devices affect them."],
    ];
    const bytes = buildXlsx([
      { name: "Doctor views", header: true, rows: [header, ...body, total], widths: [28, 22, 12, 12, 14, 15, 22, 12, 14, 18, 26] },
      { name: "About", header: false, rows: about, widths: [26, 90] },
    ]);
    downloadXlsx(`family-medic-doctor-views-${range.key}-${today}.xlsx`, bytes);
  }

  return (
    <section className="rounded-3xl border border-[#d7e7e2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]" data-testid="doctor-views">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Doctor views (admin only)</h2>
          <p className="mt-1 text-xs text-ink-500">
            How often each doctor&apos;s card is seen and opened. Doctors and patients never see these numbers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Period"
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value)}
            className="rounded-xl border border-[#d7e7e2] bg-white px-3 py-1.5 text-sm text-ink-900"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!rows || rows.length === 0}
            className="rounded-xl bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Download Excel
          </button>
        </div>
      </div>

      {note && <p className="mt-3 text-sm text-ink-700">{note}</p>}
      {loading && !rows && !note && <p className="mt-3 text-sm text-ink-500">Loading…</p>}

      {rows && rows.length === 0 && <p className="mt-3 text-sm text-ink-500">No approved doctors yet.</p>}

      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#d7e7e2] text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-3">Doctor</th>
                <th className="py-2 pr-3 text-right">Shown</th>
                <th className="py-2 pr-3 text-right">Card clicks</th>
                <th className="py-2 pr-3 text-right">Click-through</th>
                <th className="py-2 pr-3 text-right">Profile views</th>
                <th className="py-2 pr-3 text-right">Unique</th>
                <th className="py-2 pr-3 text-right">Shared card</th>
                <th className="py-2 pr-3 text-right">Book clicks</th>
                <th className="py-2 text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doctor_id} className="border-b border-[#eef5f2]">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-ink-900">{r.full_name ?? "(unnamed)"}</div>
                    {r.specialty && <div className="text-xs text-ink-500">{r.specialty}</div>}
                  </td>
                  <td className="py-2 pr-3 text-right">{r.shown}</td>
                  <td className="py-2 pr-3 text-right">{r.card_clicks}</td>
                  <td className="py-2 pr-3 text-right">{pctText(ratio(r.card_clicks, r.shown))}</td>
                  <td className="py-2 pr-3 text-right font-medium text-ink-900">{r.profile_views}</td>
                  <td className="py-2 pr-3 text-right">{r.unique_visitors}</td>
                  <td className="py-2 pr-3 text-right">{r.shared_card_views}</td>
                  <td className="py-2 pr-3 text-right">{r.book_clicks}</td>
                  <td className="py-2 text-right">{r.paid_bookings}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink-900">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 pr-3 text-right">{totals.shown}</td>
                <td className="py-2 pr-3 text-right">{totals.card_clicks}</td>
                <td className="py-2 pr-3 text-right">{pctText(ratio(totals.card_clicks, totals.shown))}</td>
                <td className="py-2 pr-3 text-right">{totals.profile_views}</td>
                <td className="py-2 pr-3 text-right">{totals.unique_visitors}</td>
                <td className="py-2 pr-3 text-right">{totals.shared_card_views}</td>
                <td className="py-2 pr-3 text-right">{totals.book_clicks}</td>
                <td className="py-2 text-right">{totals.paid_bookings}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-500">
        Numbers are directional, not exact: ad blockers, cleared browsers and several devices change the count, and
        your own test visits are included. Counting began the day this was switched on.
      </p>
    </section>
  );
}
