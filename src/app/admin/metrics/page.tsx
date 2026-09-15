"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Business metrics (2026-09-15) — the physician asked for a way to
// review "how are we doing as a business": site traffic (0036) plus a
// booking/revenue snapshot pulled from data this app already has
// (consultations, payments — no new tracking needed for those). Kept
// deliberately separate from anything about WHICH medications get
// prescribed: see the code comment on PageViewTracker and the
// conversation this was scoped in — a metric tied to prescribing volume
// for the purpose of a pharma commission was not built here, since
// paying (or being paid) based on what a doctor prescribes is a
// conflict of interest this platform doesn't take on, whatever it's
// labeled in the UI. If a transparent, aggregate view of commonly-
// prescribed medications is ever wanted for the practice's own clinical/
// formulary insight — with no money attached to it — that's a separate,
// clearly-scoped feature to design on its own.
//
// All three data sources here (site_page_views, consultations, payments)
// already have an admin-only SELECT policy from earlier migrations
// (0036, 0026) — this page reads them directly via the client, no new
// API route needed, same pattern as every other admin screen.

interface PageViewRow {
  path: string;
  referrer_host: string | null;
  visitor_id: string;
  created_at: string;
}

interface ConsultationRow {
  status: string;
  created_at: string;
}

interface PaymentRow {
  status: string;
  amount: number;
  refunded_amount: number | null;
  created_at: string;
}

const WINDOWS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
] as const;

function windowStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function topCounts(values: (string | null)[], limit: number): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v ?? "(direct / unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export default function AdminMetrics() {
  const [views, setViews] = useState<PageViewRow[] | null>(null);
  const [consultations, setConsultations] = useState<ConsultationRow[] | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const since30d = windowStart(30).toISOString();

    const [viewsRes, consultRes, paymentsRes] = await Promise.all([
      supabase.from("site_page_views").select("path, referrer_host, visitor_id, created_at").gte("created_at", since30d),
      supabase.from("consultations").select("status, created_at").gte("created_at", since30d),
      supabase.from("payments").select("status, amount, refunded_amount, created_at").gte("created_at", since30d),
    ]);

    if (viewsRes.error) return setLoadError(viewsRes.error.message);
    if (consultRes.error) return setLoadError(consultRes.error.message);
    if (paymentsRes.error) return setLoadError(paymentsRes.error.message);

    setViews(viewsRes.data as PageViewRow[]);
    setConsultations(consultRes.data as ConsultationRow[]);
    setPayments(paymentsRes.data as PaymentRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!views || !consultations || !payments) return null;

    return WINDOWS.map((w) => {
      const start = windowStart(w.days);
      const windowViews = views.filter((v) => new Date(v.created_at) >= start);
      const windowConsultations = consultations.filter((c) => new Date(c.created_at) >= start);
      const windowPayments = payments.filter((p) => new Date(p.created_at) >= start);

      const uniqueVisitors = new Set(windowViews.map((v) => v.visitor_id)).size;
      const completed = windowConsultations.filter((c) => c.status === "completed").length;
      const succeededPayments = windowPayments.filter((p) => p.status === "succeeded");
      const revenue = succeededPayments.reduce((sum, p) => sum + p.amount - (p.refunded_amount ?? 0), 0);
      const refunded = succeededPayments.reduce((sum, p) => sum + (p.refunded_amount ?? 0), 0);

      return {
        key: w.key,
        label: w.label,
        pageViews: windowViews.length,
        uniqueVisitors,
        bookingsStarted: windowConsultations.length,
        completed,
        revenue,
        refunded,
      };
    });
  }, [views, consultations, payments]);

  const topPages = useMemo(() => (views ? topCounts(views.map((v) => v.path), 6) : []), [views]);
  const topReferrers = useMemo(
    () => (views ? topCounts(views.map((v) => v.referrer_host), 6) : []),
    [views]
  );

  return (
    <AdminGuard title="Business metrics">
      {() => (
        <div>
          <PageHeader
            title="Business metrics"
            subtitle="Site traffic plus a booking and revenue snapshot, over the last 30 days."
          />
          <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            {!stats ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <>
                <section className="grid gap-4 sm:grid-cols-3">
                  {stats.map((s) => (
                    <div key={s.key} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Page views</dt>
                          <dd className="font-semibold text-slate-900">{s.pageViews}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Unique visitors</dt>
                          <dd className="font-semibold text-slate-900">{s.uniqueVisitors}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Bookings started</dt>
                          <dd className="font-semibold text-slate-900">{s.bookingsStarted}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Completed</dt>
                          <dd className="font-semibold text-slate-900">{s.completed}</dd>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-2">
                          <dt className="text-slate-500">Revenue collected</dt>
                          <dd className="font-semibold text-teal-700">PKR {s.revenue.toLocaleString()}</dd>
                        </div>
                        {s.refunded > 0 && (
                          <div className="flex justify-between">
                            <dt className="text-slate-500">Refunded</dt>
                            <dd className="font-medium text-red-600">PKR {s.refunded.toLocaleString()}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  ))}
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-sm font-semibold text-slate-900">Top pages (30 days)</h2>
                    {topPages.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-400">No page views recorded yet.</p>
                    ) : (
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {topPages.map((p) => (
                          <li key={p.key} className="flex justify-between">
                            <span className="text-slate-700">{p.key}</span>
                            <span className="font-medium text-slate-900">{p.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-sm font-semibold text-slate-900">Where visitors come from (30 days)</h2>
                    {topReferrers.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-400">No page views recorded yet.</p>
                    ) : (
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {topReferrers.map((r) => (
                          <li key={r.key} className="flex justify-between">
                            <span className="text-slate-700">{r.key}</span>
                            <span className="font-medium text-slate-900">{r.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <p className="text-xs text-slate-400">
                  Traffic is counted only on the public site (home, marketing pages, and the start of booking/
                  registration) — never inside a signed-in patient or doctor dashboard. It's a first-party count with
                  no third-party analytics service and no IP address stored, so treat it as directionally accurate
                  rather than exact (a visitor who clears their browser storage, or uses more than one device, will
                  be counted more than once).
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
