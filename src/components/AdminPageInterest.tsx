"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildXlsx, downloadXlsx, type XlsxCell } from "@/lib/xlsxExport";

// Admin-only "What visitors look at": Our Doctors page vs each doctor's
// profile vs the free tools. Uses the page views the metrics page already
// loads (site_page_views) — nothing new is recorded. Doctor names come from
// the public doctor directory; a doctor who is no longer listed shows as
// "(not listed)". "Free tools" counts people who OPENED a tool page, not
// people who pressed Calculate.

interface ViewRow {
  path: string;
  visitor_id: string;
  created_at: string;
}

const PERIODS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
] as const;

const UUID = /^\/doctors\/([0-9a-f-]{36})\/?$/i;

function startOf(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function toolLabel(path: string): string {
  if (path === "/calculators") return "Free tools hub";
  const slug = path.replace(/^\/calculators\//, "").replace(/\/$/, "");
  if (slug === "bmi") return "BMI calculator";
  if (slug === "due-date") return "Due-date calculator";
  return slug;
}

export default function AdminPageInterest({ views }: { views: ViewRow[] }) {
  const [periodKey, setPeriodKey] = useState<string>("30d");
  const [names, setNames] = useState<Record<string, string>>({});
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[2];

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await client.from("public_doctor_directory").select("id, full_name");
      if (cancelled || error || !data) return;
      const map: Record<string, string> = {};
      for (const d of data as { id: string; full_name: string }[]) map[d.id] = d.full_name;
      setNames(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const report = useMemo(() => {
    const start = startOf(period.days);
    const inWindow = views.filter((v) => new Date(v.created_at) >= start);
    const agg = (rows: ViewRow[]) => ({ views: rows.length, visitors: new Set(rows.map((r) => r.visitor_id)).size });
    const list = agg(inWindow.filter((v) => v.path === "/doctors" || v.path === "/doctors/"));
    const profileRows = inWindow.filter((v) => UUID.test(v.path));
    const profiles = agg(profileRows);
    const byDoctor = new Map<string, ViewRow[]>();
    for (const v of profileRows) {
      const id = (v.path.match(UUID) as RegExpMatchArray)[1].toLowerCase();
      byDoctor.set(id, [...(byDoctor.get(id) ?? []), v]);
    }
    const doctors = Array.from(byDoctor.entries())
      .map(([id, rows]) => ({ id, ...agg(rows) }))
      .sort((a, b) => b.views - a.views);
    const toolRows = inWindow.filter((v) => v.path === "/calculators" || v.path.startsWith("/calculators/"));
    const byTool = new Map<string, ViewRow[]>();
    for (const v of toolRows) {
      const p = v.path.replace(/\/$/, "");
      byTool.set(p, [...(byTool.get(p) ?? []), v]);
    }
    const tools = Array.from(byTool.entries())
      .map(([path, rows]) => ({ path, label: toolLabel(path), ...agg(rows) }))
      .sort((a, b) => b.views - a.views);
    return { list, profiles, doctors, tools, toolsAll: agg(toolRows) };
  }, [views, period.days]);

  const nameOf = (id: string) => names[id] ?? names[id.toLowerCase()] ?? "(not listed)";

  function exportExcel() {
    const header: XlsxCell[] = ["What", "Page views", "Visitors"];
    const rows: XlsxCell[][] = [
      header,
      ["Our Doctors page", report.list.views, report.list.visitors],
      ["All doctor profiles (combined)", report.profiles.views, report.profiles.visitors],
      ...report.doctors.map((d): XlsxCell[] => [`Profile: ${nameOf(d.id)}`, d.views, d.visitors]),
      ["Free tools (combined)", report.toolsAll.views, report.toolsAll.visitors],
      ...report.tools.map((t): XlsxCell[] => [`Tool: ${t.label}`, t.views, t.visitors]),
    ];
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(
      `family-medic-page-interest-${period.key}-${today}.xlsx`,
      buildXlsx([{ name: "Page interest", header: true, rows, widths: [42, 14, 12] }]),
    );
  }

  const cell = "py-2 pr-3 text-right";
  return (
    <section
      className="rounded-3xl border border-[#d7e7e2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]"
      data-testid="page-interest"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Doctors page, doctor profiles and free tools</h2>
          <p className="mt-1 text-xs text-ink-500">
            How many times each was opened, and by how many different visitors.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Period"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="rounded-xl border border-[#d7e7e2] bg-white px-3 py-1.5 text-sm text-ink-900"
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <button type="button" onClick={exportExcel} className="rounded-xl bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white">
            Download Excel
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#d7e7e2] text-xs uppercase tracking-wide text-ink-500">
              <th className="py-2 pr-3">Page</th>
              <th className="py-2 pr-3 text-right">Views</th>
              <th className="py-2 text-right">Visitors</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#eef5f2] font-medium text-ink-900">
              <td className="py-2 pr-3">Our Doctors page</td>
              <td className={cell}>{report.list.views}</td>
              <td className="py-2 text-right">{report.list.visitors}</td>
            </tr>
            <tr className="border-b border-[#eef5f2] font-medium text-ink-900">
              <td className="py-2 pr-3">All doctor profiles (combined)</td>
              <td className={cell}>{report.profiles.views}</td>
              <td className="py-2 text-right">{report.profiles.visitors}</td>
            </tr>
            {report.doctors.map((d) => (
              <tr key={d.id} className="border-b border-[#eef5f2] text-ink-700">
                <td className="py-2 pr-3 pl-4">{nameOf(d.id)}</td>
                <td className={cell}>{d.views}</td>
                <td className="py-2 text-right">{d.visitors}</td>
              </tr>
            ))}
            {report.doctors.length === 0 && (
              <tr><td colSpan={3} className="py-2 pl-4 text-ink-500">No doctor profile views in this period.</td></tr>
            )}
            <tr className="border-b border-[#eef5f2] font-medium text-ink-900">
              <td className="py-2 pr-3">Free tools (combined)</td>
              <td className={cell}>{report.toolsAll.views}</td>
              <td className="py-2 text-right">{report.toolsAll.visitors}</td>
            </tr>
            {report.tools.map((t) => (
              <tr key={t.path} className="border-b border-[#eef5f2] text-ink-700">
                <td className="py-2 pr-3 pl-4">{t.label}</td>
                <td className={cell}>{t.views}</td>
                <td className="py-2 text-right">{t.visitors}</td>
              </tr>
            ))}
            {report.tools.length === 0 && (
              <tr><td colSpan={3} className="py-2 pl-4 text-ink-500">No free-tool visits in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-500">
        &ldquo;Free tools&rdquo; counts people who opened a tool page, not people who pressed Calculate. Your own
        visits are included, and ad blockers or cleared browsers make the counts slightly low.
      </p>
    </section>
  );
}
