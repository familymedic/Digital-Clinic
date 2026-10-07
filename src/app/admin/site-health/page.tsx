"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Site health (2026-10-07). Doctors reported the sign-up page freezing on
// "Submitting…" and nobody was told. Browsers and critical server routes
// now report slow / failed / timed-out requests and JavaScript errors
// (see src/lib/telemetry.ts, migration 0066); this page is where they show
// up, grouped by what is hurting, so a problem is visible the same day
// instead of being discovered by a doctor's complaint. Technical facts
// only — never a name, email, health detail or anything a person typed.

interface EventRow {
  id: string;
  created_at: string;
  source: "client" | "server";
  kind: "slow" | "fail" | "timeout" | "js_error" | "server_error";
  label: string;
  message: string | null;
  duration_ms: number | null;
  page: string | null;
  effective_type: string | null;
  online: boolean | null;
  user_agent: string | null;
  alerted: boolean;
}

const KIND_INFO: Record<EventRow["kind"], { label: string; tone: string; meaning: string }> = {
  server_error: { label: "Server error", tone: "bg-red-100 text-red-800", meaning: "Our own server failed to complete something important (e.g. a registration or a payment start). Needs attention." },
  timeout: { label: "No answer", tone: "bg-red-100 text-red-800", meaning: "A request got no answer at all within the time limit — what used to look like a frozen button." },
  fail: { label: "Failed", tone: "bg-amber-100 text-amber-800", meaning: "A request broke (connection dropped, or the server answered with an error)." },
  js_error: { label: "Page error", tone: "bg-amber-100 text-amber-800", meaning: "Something in the page's own code went wrong in someone's browser." },
  slow: { label: "Slow", tone: "bg-slate-100 text-slate-700", meaning: "It worked but took more than 8 seconds." },
};

function browserOf(ua: string | null): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Other";
  const br = /SamsungBrowser/.test(ua) ? "Samsung" : /Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "browser";
  return `${br} · ${os}`;
}

type Filter = "all" | "serious" | "failed" | "slow";
const FILTERS: Record<Filter, EventRow["kind"][] | null> = {
  all: null,
  serious: ["server_error", "timeout"],
  failed: ["fail", "js_error"],
  slow: ["slow"],
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);

export default function SiteHealth() {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const now = Date.now();
      const since = new Date(now - 7 * 86_400_000).toISOString();
      // Reports are only useful for a week: remove anything older each time this page opens.
      await supabase.from("client_events").delete().lt("created_at", since);
      const { data, error } = await supabase
        .from("client_events")
        .select("id, created_at, source, kind, label, message, duration_ms, page, effective_type, online, user_agent, alerted")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1500);
      if (cancelled) return;
      if (error) {
        setLoadError(
          /client_events/.test(error.message) ? "The site-health table isn't set up yet — run migration 0066 in Supabase first." : error.message
        );
        return;
      }
      setLoadError(null);
      setLoadedAt(now);
      setRows(data as EventRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const visible = useMemo(() => {
    const kinds = FILTERS[filter];
    return (rows ?? []).filter((r) => !kinds || kinds.includes(r.kind));
  }, [rows, filter]);

  const summary = useMemo(() => {
    const day = loadedAt - 86_400_000;
    const last24 = (rows ?? []).filter((r) => new Date(r.created_at).getTime() >= day);
    const count = (k: EventRow["kind"][]) => last24.filter((r) => k.includes(r.kind)).length;
    return {
      serious: count(["server_error", "timeout"]),
      failed: count(["fail", "js_error"]),
      slow: count(["slow"]),
      total: last24.length,
    };
  }, [rows, loadedAt]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; kind: EventRow["kind"]; n24: number; n7: number; worst: number | null; last: string; conns: Set<string> }>();
    const day = loadedAt - 86_400_000;
    for (const r of visible) {
      const key = `${r.kind}|${r.label}`;
      const g = map.get(key) ?? { label: r.label, kind: r.kind, n24: 0, n7: 0, worst: null, last: r.created_at, conns: new Set<string>() };
      g.n7 += 1;
      if (new Date(r.created_at).getTime() >= day) g.n24 += 1;
      if (r.duration_ms != null && (g.worst == null || r.duration_ms > g.worst)) g.worst = r.duration_ms;
      if (r.created_at > g.last) g.last = r.created_at;
      if (r.effective_type) g.conns.add(r.effective_type);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.n24 - a.n24 || b.n7 - a.n7).slice(0, 25);
  }, [visible, loadedAt]);

  async function clearAll() {
    if (!supabase) return;
    if (!window.confirm("Clear all reports? Do this after you have fixed the problems, so new ones stand out.")) return;
    await supabase.from("client_events").delete().gte("created_at", "1970-01-01");
    setReloadKey((k) => k + 1);
  }

  function copySummary() {
    const lines = groups.map(
      (g) =>
        `- [${KIND_INFO[g.kind].label}] ${g.label} — ${g.n24} in 24h, ${g.n7} in 7 days, worst ${secs(g.worst)}, connections: ${[...g.conns].join("/") || "n/a"}, last ${when(g.last)}`
    );
    const examples = (rows ?? [])
      .filter((r) => r.message)
      .slice(0, 15)
      .map((r) => `  * ${r.label} on ${r.page ?? "?"}: ${r.message}`);
    const text = `Family Medic site-health report (last 7 days)\n${lines.join("\n") || "- nothing reported"}\n\nSample details:\n${examples.join("\n") || "  (none)"}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <AdminGuard title="Site health">
      {() => (
        <div>
          <PageHeader
            title="Site health"
            subtitle="Slow, failed and frozen requests reported by real users' browsers and by our own server — so lag is seen here before anyone has to complain."
          />
          <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</p>}

            {rows && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(["all", "serious", "failed", "slow"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-full border px-3 py-1.5 font-semibold ${filter === f ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                    >
                      {{ all: "Everything", serious: "Serious", failed: "Failed & page errors", slow: "Slow" }[f]}
                    </button>
                  ))}
                  <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
                  <button onClick={copySummary} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700">
                    {copied ? "Copied — paste it to Claude" : "Copy report for Claude"}
                  </button>
                  <button onClick={() => setReloadKey((k) => k + 1)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700">
                    Refresh
                  </button>
                  <button onClick={clearAll} className="rounded-full border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-700">
                    Clear all reports
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Serious (24h)", value: summary.serious, tone: summary.serious > 0 ? "text-red-700" : "text-teal-700" },
                    { label: "Failed / page errors (24h)", value: summary.failed, tone: summary.failed > 0 ? "text-amber-700" : "text-teal-700" },
                    { label: "Slow requests (24h)", value: summary.slow, tone: "text-slate-700" },
                    { label: "All reports (24h)", value: summary.total, tone: "text-slate-700" },
                  ].map((c) => (
                    <div key={c.label} className="rounded-2xl border border-ink-border bg-white p-4 shadow-sm">
                      <div className={`text-2xl font-extrabold ${c.tone}`}>{c.value}</div>
                      <div className="mt-1 text-xs text-ink-500">{c.label}</div>
                    </div>
                  ))}
                </div>

                {rows.length === 0 ? (
                  <p className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
                    Nothing has been reported in the last 7 days (older reports are deleted automatically). That is good news — but it only covers people whose phones could reach
                    us. If everything is down, the uptime monitor (see below) is what tells you.
                  </p>
                ) : (
                  <>
                    <section>
                      <h2 className="text-sm font-bold text-slate-900">What is hurting most</h2>
                      <p className="mt-1 text-xs text-slate-500">Grouped by the thing that was slow or broken. “Connection” is the visitor&rsquo;s network type, e.g. 4g or 3g.</p>
                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Type</th>
                              <th className="px-3 py-2 font-semibold">What</th>
                              <th className="px-3 py-2 font-semibold">24h</th>
                              <th className="px-3 py-2 font-semibold">7 days</th>
                              <th className="px-3 py-2 font-semibold">Worst</th>
                              <th className="px-3 py-2 font-semibold">Connection</th>
                              <th className="px-3 py-2 font-semibold">Last seen</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {groups.map((g) => (
                              <tr key={`${g.kind}|${g.label}`}>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_INFO[g.kind].tone}`}>{KIND_INFO[g.kind].label}</span>
                                </td>
                                <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{g.label}</td>
                                <td className="px-3 py-2 font-semibold">{g.n24}</td>
                                <td className="px-3 py-2">{g.n7}</td>
                                <td className="px-3 py-2">{secs(g.worst)}</td>
                                <td className="px-3 py-2">{[...g.conns].join(", ") || "—"}</td>
                                <td className="px-3 py-2 text-slate-500">{when(g.last)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section>
                      <h2 className="text-sm font-bold text-slate-900">Latest reports</h2>
                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-semibold">When (PKT)</th>
                              <th className="px-3 py-2 font-semibold">Type</th>
                              <th className="px-3 py-2 font-semibold">On page</th>
                              <th className="px-3 py-2 font-semibold">What</th>
                              <th className="px-3 py-2 font-semibold">Took</th>
                              <th className="px-3 py-2 font-semibold">Device</th>
                              <th className="px-3 py-2 font-semibold">Detail</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {visible.slice(0, showAll ? 500 : 50).map((r) => (
                              <tr key={r.id}>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{when(r.created_at)}</td>
                                <td className="px-3 py-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_INFO[r.kind].tone}`}>{KIND_INFO[r.kind].label}</span>
                                </td>
                                <td className="px-3 py-2 font-mono text-[11px]">{r.page ?? "—"}</td>
                                <td className="px-3 py-2 font-mono text-[11px]">{r.label}</td>
                                <td className="px-3 py-2">{secs(r.duration_ms)}</td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  {browserOf(r.user_agent)}
                                  {r.effective_type ? ` · ${r.effective_type}` : ""}
                                  {r.online === false ? " · offline" : ""}
                                </td>
                                <td className="px-3 py-2 text-slate-600">{r.message ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {visible.length > 50 && !showAll && (
                        <button onClick={() => setShowAll(true)} className="mt-2 text-xs font-semibold text-teal-700 underline underline-offset-2">
                          Show more ({Math.min(visible.length, 500) - 50} more)
                        </button>
                      )}
                    </section>
                  </>
                )}
              </>
            )}

            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">How to read this</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {(Object.keys(KIND_INFO) as EventRow["kind"][]).map((k) => (
                  <li key={k}>
                    <strong>{KIND_INFO[k].label}:</strong> {KIND_INFO[k].meaning}
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                You are alerted by push notification and email when the same problem repeats (once per hour per problem). Reports are kept
                for 7 days and older ones are deleted automatically. If the whole site is down nobody&rsquo;s browser can report anything, so keep the free uptime monitor pointed at{" "}
                <span className="font-mono">/api/health</span>.
              </p>
            </section>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
