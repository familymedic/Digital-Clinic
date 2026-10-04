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

// Patient-flow addition (2026-09-18, physician request): every account
// gets an auto-created "self" family_members row (relationship='self')
// at signup, so that row's created_at doubles as "when this family
// registered." Read via admin_patient_flow_rows() (0040), a
// security-definer function that already excludes doctor/admin
// accounts and returns only what's needed for these counts — never a
// patient's name or date of birth.
interface PatientFlowRow {
  account_id: string;
  relationship: string;
  created_at: string;
}

// Installed-app tracking (2026-10-04, physician request): read from
// app_install_events (0060). Fetched SEPARATELY and fail-soft — if the
// migration hasn't been run yet, the "Installed app" section just stays
// hidden and everything else on this page works exactly as before.
interface AppEventRow {
  event_type: "installed" | "app_opened";
  platform: "android" | "ios" | "desktop" | "other";
  visitor_id: string;
  created_at: string;
}

const PLATFORM_LABELS: Record<AppEventRow["platform"], string> = {
  android: "Android",
  ios: "iPhone / iPad",
  desktop: "Desktop",
  other: "Other",
};

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

// Supabase caps one request at 1,000 rows, so read app-install events in
// pages until a short page comes back. The table is small (installs are
// rare; opens are throttled to one per person per day), but this keeps
// the counts right as it grows instead of silently stopping at 1,000.
async function fetchAppEvents(
  eventType: AppEventRow["event_type"],
  sinceIso: string | null
): Promise<AppEventRow[] | null> {
  if (!supabase) return null;
  const pageSize = 1000;
  const all: AppEventRow[] = [];
  for (let from = 0; from < 100_000; from += pageSize) {
    let query = supabase
      .from("app_install_events")
      .select("event_type, platform, visitor_id, created_at")
      .eq("event_type", eventType)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (sinceIso) query = query.gte("created_at", sinceIso);
    const { data, error } = await query;
    if (error) return null;
    all.push(...(data as AppEventRow[]));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export default function AdminMetrics() {
  const [appInstalls, setAppInstalls] = useState<AppEventRow[] | null>(null);
  const [appOpens, setAppOpens] = useState<AppEventRow[] | null>(null);
  const [views, setViews] = useState<PageViewRow[] | null>(null);
  const [consultations, setConsultations] = useState<ConsultationRow[] | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [patientFlow, setPatientFlow] = useState<PatientFlowRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const since30d = windowStart(30).toISOString();

    const [viewsRes, consultRes, paymentsRes, patientFlowRes] = await Promise.all([
      supabase.from("site_page_views").select("path, referrer_host, visitor_id, created_at").gte("created_at", since30d),
      supabase.from("consultations").select("status, created_at").gte("created_at", since30d),
      supabase.from("payments").select("status, amount, refunded_amount, created_at").gte("created_at", since30d),
      supabase.rpc("admin_patient_flow_rows"),
    ]);

    if (viewsRes.error) return setLoadError(viewsRes.error.message);
    if (consultRes.error) return setLoadError(consultRes.error.message);
    if (paymentsRes.error) return setLoadError(paymentsRes.error.message);
    if (patientFlowRes.error) return setLoadError(patientFlowRes.error.message);

    setViews(viewsRes.data as PageViewRow[]);
    setConsultations(consultRes.data as ConsultationRow[]);
    setPayments(paymentsRes.data as PaymentRow[]);
    setPatientFlow(patientFlowRes.data as PatientFlowRow[]);

    // Installed-app events: separate and fail-soft (see AppEventRow).
    const [installsRes, opensRes] = await Promise.all([
      fetchAppEvents("installed", null),
      fetchAppEvents("app_opened", since30d),
    ]);
    if (installsRes && opensRes) {
      setAppInstalls(installsRes);
      setAppOpens(opensRes);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!views || !consultations || !payments || !patientFlow) return null;

    return WINDOWS.map((w) => {
      const start = windowStart(w.days);
      const windowViews = views.filter((v) => new Date(v.created_at) >= start);
      const windowConsultations = consultations.filter((c) => new Date(c.created_at) >= start);
      const windowPayments = payments.filter((p) => new Date(p.created_at) >= start);
      const windowFlow = patientFlow.filter((f) => new Date(f.created_at) >= start);

      const uniqueVisitors = new Set(windowViews.map((v) => v.visitor_id)).size;
      const completed = windowConsultations.filter((c) => c.status === "completed").length;
      const succeededPayments = windowPayments.filter((p) => p.status === "succeeded");
      const revenue = succeededPayments.reduce((sum, p) => sum + p.amount - (p.refunded_amount ?? 0), 0);
      const refunded = succeededPayments.reduce((sum, p) => sum + (p.refunded_amount ?? 0), 0);
      // Only the "self" row marks a family's own registration moment —
      // an added spouse/child/parent isn't a new family, just a new
      // patient under an existing one.
      const newFamilies = windowFlow.filter((f) => f.relationship === "self").length;
      const newPatients = windowFlow.length;

      return {
        key: w.key,
        label: w.label,
        pageViews: windowViews.length,
        uniqueVisitors,
        bookingsStarted: windowConsultations.length,
        completed,
        revenue,
        refunded,
        newFamilies,
        newPatients,
      };
    });
  }, [views, consultations, payments, patientFlow]);

  // Installed-app numbers. A person is a distinct visitor_id; the same
  // person installing twice, or opening the app on many days, counts once
  // per window.
  const appStats = useMemo(() => {
    if (!appInstalls || !appOpens) return null;
    const windows = WINDOWS.map((w) => {
      const start = windowStart(w.days);
      const installs = new Set(
        appInstalls.filter((e) => new Date(e.created_at) >= start).map((e) => e.visitor_id)
      ).size;
      const active = new Set(
        appOpens.filter((e) => new Date(e.created_at) >= start).map((e) => e.visitor_id)
      ).size;
      return { key: w.key, label: w.label, installs, active };
    });
    const installsAllTime = new Set(appInstalls.map((e) => e.visitor_id)).size;
    const byPlatform = (Object.keys(PLATFORM_LABELS) as AppEventRow["platform"][])
      .map((p) => ({
        platform: p,
        label: PLATFORM_LABELS[p],
        active: new Set(appOpens.filter((e) => e.platform === p).map((e) => e.visitor_id)).size,
        installs: new Set(appInstalls.filter((e) => e.platform === p).map((e) => e.visitor_id)).size,
      }))
      .filter((r) => r.active > 0 || r.installs > 0);
    return { windows, installsAllTime, byPlatform };
  }, [appInstalls, appOpens]);

  const totalFamilies = useMemo(
    () => (patientFlow ? new Set(patientFlow.map((f) => f.account_id)).size : null),
    [patientFlow]
  );
  const totalPatients = patientFlow ? patientFlow.length : null;

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
                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Families registered (all time)
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-900">{totalFamilies}</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Distinct accounts — one account can book for several people.
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Patients registered (all time)
                    </div>
                    <div className="mt-2 text-3xl font-bold text-slate-900">{totalPatients}</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Every individual person who can receive care — the account holder plus every
                      family member they&rsquo;ve added. Doctor and admin accounts are excluded.
                    </p>
                  </div>
                </section>

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
                          <dt className="text-slate-500">New families</dt>
                          <dd className="font-semibold text-slate-900">{s.newFamilies}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">New patients</dt>
                          <dd className="font-semibold text-slate-900">{s.newPatients}</dd>
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

                {appStats && (
                  <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-sm font-semibold text-slate-900">Installed app (home-screen app)</h2>
                    <div className="mt-3 grid gap-4 sm:grid-cols-3">
                      {appStats.windows.map((w) => (
                        <div key={w.key}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{w.label}</div>
                          <dl className="mt-2 space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <dt className="text-slate-500">New installs detected</dt>
                              <dd className="font-semibold text-slate-900">{w.installs}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">People using the app</dt>
                              <dd className="font-semibold text-slate-900">{w.active}</dd>
                            </div>
                          </dl>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm">
                      <span className="text-slate-500">Installs detected (all time)</span>
                      <span className="font-semibold text-teal-700">{appStats.installsAllTime}</span>
                    </div>
                    {appStats.byPlatform.length > 0 && (
                      <div className="mt-3 text-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          By device (people using the app, 30 days)
                        </div>
                        <ul className="mt-2 space-y-1">
                          {appStats.byPlatform.map((r) => (
                            <li key={r.platform} className="flex justify-between">
                              <span className="text-slate-700">{r.label}</span>
                              <span className="font-medium text-slate-900">{r.active}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-4 text-xs text-slate-400">
                      &ldquo;New installs detected&rdquo; counts the browser&rsquo;s own install signal, which Android
                      and desktop Chrome/Edge send but iPhones never do, so iPhone installs show up only under
                      &ldquo;People using the app&rdquo; (someone who opened it from their home screen). That count
                      also includes people who installed before this tracking began, from their next open. Uninstalls
                      can&rsquo;t be detected, and a person who clears their browser storage or uses two devices is
                      counted more than once. Counting starts the day this was switched on.
                    </p>
                  </section>
                )}

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
