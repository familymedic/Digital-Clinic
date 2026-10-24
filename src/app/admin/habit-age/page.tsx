"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { PROVINCE_CHIPS, weekLabel } from "@/lib/habitAge";

// Admin control + report for the Habit Age game (migration 0084). Admins
// always see exact numbers; the public only sees entry counts when the
// "show entry counts" switch is on. No individual data exists anywhere:
// only anonymous daily totals per city and gender.

interface Settings {
  game_live: boolean;
  league_live: boolean;
  show_counts: boolean;
  min_entries: number;
  auto_publish: boolean;
}
interface CityStat {
  city_id: number;
  name: string;
  province: string;
  entries: number;
  avg_score: number | null;
  female: number;
  male: number;
  unsaid: number;
}
interface Stats {
  from: string;
  to: string;
  events: Record<string, number>;
  cities: CityStat[];
  daily: { day: string; completes: number }[];
}
interface Draft {
  week_start: string;
  min_entries: number;
  best: { name: string; province: string; score: number } | null;
  improved: { name: string; province: string; delta: number; score: number } | null;
  published: boolean;
}
interface CityRow {
  id: number;
  name: string;
  province: string;
  is_active: boolean;
}

const CARD = "rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]";
const INPUT = "mt-1 block w-full rounded-md border border-[#d7e7e2] px-3 py-2 text-sm";

function friendly(message: string): string {
  if (/function .*does not exist|Could not find the function|relation .* does not exist/i.test(message)) {
    return "The Habit Age database update (migration 0084) has not been run yet.";
  }
  if (message.includes("not_admin")) return "Only an admin account can do this.";
  if (message.includes("week_not_finished")) return "That week has not finished yet.";
  if (message.includes("already_published")) return "That week's winners are already published.";
  if (message.includes("no_city_reached_minimum")) return "No city has reached the minimum number of entries that week, so there is nothing to publish.";
  if (message.includes("bad_min_entries")) return "Minimum entries must be a whole number of 1 or more.";
  return message;
}

function Num({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-[#f5faf8] p-4">
      <div className="text-2xl font-extrabold text-ink-900">{value}</div>
      <div className="text-xs font-semibold text-ink-700">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

function pct(a: number, b: number): string {
  if (!b) return "-";
  return `${Math.round((a * 100) / b)}%`;
}

function Inner() {
  const [tab, setTab] = useState<"settings" | "stats" | "cities">("settings");
  const [s, setS] = useState<Settings | null>(null);
  const [gameLive, setGameLive] = useState(true);
  const [leagueLive, setLeagueLive] = useState(true);
  const [showCounts, setShowCounts] = useState(false);
  const [minEntries, setMinEntries] = useState("100");
  const [autoPublish, setAutoPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [publishedWeeks, setPublishedWeeks] = useState<string[]>([]);

  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityFilter, setCityFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [newProvince, setNewProvince] = useState("Punjab");

  const loadSettings = useCallback(async () => {
    if (!supabase) return;
    const g = await supabase.rpc("habit_admin_get");
    if (g.error) {
      setErr(friendly(g.error.message));
      return;
    }
    const v = g.data as Settings;
    setS(v);
    setGameLive(v.game_live);
    setLeagueLive(v.league_live);
    setShowCounts(v.show_counts);
    setMinEntries(String(v.min_entries));
    setAutoPublish(v.auto_publish);
  }, []);

  const loadStats = useCallback(async (d: number) => {
    if (!supabase) return;
    const r = await supabase.rpc("habit_admin_stats", { p_days: d });
    if (r.error) {
      setErr(friendly(r.error.message));
      return;
    }
    setStats(r.data as Stats);
    const w = await supabase.rpc("habit_admin_winner_draft");
    if (!w.error) setDraft(w.data as Draft);
    const pw = await supabase.from("habit_winners").select("week_start").order("week_start", { ascending: false }).limit(8);
    if (!pw.error) setPublishedWeeks((pw.data ?? []).map((x: { week_start: string }) => x.week_start));
  }, []);

  const loadCities = useCallback(async () => {
    if (!supabase) return;
    const r = await supabase.from("habit_cities").select("id,name,province,is_active").order("name").limit(2000);
    if (r.error) setErr(friendly(r.error.message));
    else setCities((r.data ?? []) as CityRow[]);
  }, []);

  useEffect(() => {
    Promise.resolve().then(loadSettings);
  }, [loadSettings]);
  useEffect(() => {
    if (tab === "stats") Promise.resolve().then(() => loadStats(days));
    if (tab === "cities") Promise.resolve().then(loadCities);
  }, [tab, days, loadStats, loadCities]);

  async function save() {
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    const { error } = await supabase.rpc("habit_admin_save", {
      p_game_live: gameLive,
      p_league_live: leagueLive,
      p_show_counts: showCounts,
      p_min_entries: Math.round(Number(minEntries)) || 0,
      p_auto_publish: autoPublish,
    });
    setBusy(false);
    if (error) setErr(friendly(error.message));
    else {
      setSaved("Saved. The public pages update within a minute.");
      await loadSettings();
    }
  }

  async function publish(week: string) {
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("habit_admin_publish_winners", { p_week: week });
    setBusy(false);
    if (error) setErr(friendly(error.message));
    else await loadStats(days);
  }
  async function unpublish(week: string) {
    if (!supabase) return;
    if (!window.confirm("Hide this week's winners from the public pages?")) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("habit_admin_unpublish_winners", { p_week: week });
    setBusy(false);
    if (error) setErr(friendly(error.message));
    else await loadStats(days);
  }

  async function toggleCity(c: CityRow) {
    if (!supabase) return;
    setErr(null);
    const { error } = await supabase.from("habit_cities").update({ is_active: !c.is_active }).eq("id", c.id);
    if (error) setErr(friendly(error.message));
    else setCities((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)));
  }
  async function addCity() {
    if (!supabase) return;
    const name = newName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) {
      setErr("Enter a city name (2 to 60 letters).");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("habit_cities").insert({ name, province: newProvince });
    if (error) setErr(/duplicate|unique/i.test(error.message) ? "That city is already in the list." : friendly(error.message));
    else {
      setNewName("");
      await loadCities();
    }
  }

  const ev = stats?.events ?? {};
  const maxDaily = useMemo(() => Math.max(1, ...(stats?.daily ?? []).map((d) => d.completes)), [stats]);
  const totalEntries = (stats?.cities ?? []).reduce((a, c) => a + Number(c.entries), 0);
  const shownCities = cities.filter((c) => !cityFilter.trim() || c.name.toLowerCase().includes(cityFilter.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      {err && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["settings", "Settings"],
            ["stats", "Stats"],
            ["cities", "Cities"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-5 py-2 text-sm font-extrabold transition ${
              tab === k ? "bg-teal-700 text-white" : "bg-white text-ink-700 hover:bg-[#e6f5f2]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "settings" && (
        <div className={CARD}>
          <h2 className="text-lg font-extrabold text-ink-900">Game settings</h2>
          <p className="mt-1 text-xs text-ink-500">
            Changes reach the public pages within about a minute (they are cached to keep the site fast).
          </p>
          <div className="mt-5 space-y-4">
            <label className="flex items-start gap-3 text-sm text-ink-900">
              <input type="checkbox" checked={gameLive} onChange={(e) => setGameLive(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-[#d7e7e2] text-teal-700" />
              <span>
                <b>Game is live.</b> Untick to switch the whole game off (people see a short-break message).
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-ink-900">
              <input type="checkbox" checked={leagueLive} onChange={(e) => setLeagueLive(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-[#d7e7e2] text-teal-700" />
              <span>
                <b>City league is live.</b> Untick to hide the league, city averages and winners (the game still counts rounds).
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-ink-900">
              <input type="checkbox" checked={showCounts} onChange={(e) => setShowCounts(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-[#d7e7e2] text-teal-700" />
              <span>
                <b>Show entry counts publicly.</b> When on, the league shows the exact number of entries for each city
                (last 7 days). When off, nobody but you sees numbers.
              </span>
            </label>
            <label className="block max-w-xs text-xs font-semibold text-ink-700">
              Minimum entries for City of the Week
              <input type="number" min={1} value={minEntries} onChange={(e) => setMinEntries(e.target.value)} className={INPUT} />
            </label>
            <label className="flex items-start gap-3 text-sm text-ink-900">
              <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-[#d7e7e2] text-teal-700" />
              <span>
                <b>Publish weekly winners automatically.</b> Leave off to approve each week yourself in the Stats tab (recommended at first).
              </span>
            </label>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <button type="button" disabled={busy || !s} onClick={save} className="rounded-full bg-teal-700 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:bg-[#b9d3cd]">
              {busy ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm font-semibold text-teal-700">{saved}</span>}
          </div>
        </div>
      )}

      {tab === "stats" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-full px-4 py-1.5 text-xs font-extrabold ${days === d ? "bg-ink-900 text-white" : "bg-white text-ink-700"}`}
              >
                Last {d} days
              </button>
            ))}
            {stats && <span className="text-xs text-ink-500">{stats.from} to {stats.to} (Pakistan dates)</span>}
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Who used the game</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Visits" value={ev.visit ?? 0} hint="game page opened (once per visit)" />
              <Num label="Rounds started" value={ev.start ?? 0} />
              <Num label="Rounds completed" value={ev.complete ?? 0} hint={`${pct(ev.complete ?? 0, ev.start ?? 0)} of started`} />
              <Num label="Returning players" value={pct(ev.returning ?? 0, ev.complete ?? 0)} hint={`${ev.returning ?? 0} of completed rounds`} />
              <Num label="Card shares" value={ev.share ?? 0} />
              <Num label="'Ask a doctor' taps" value={ev.doctor_tap ?? 0} />
              <Num label="Channel taps" value={ev.channel_tap ?? 0} />
              <Num label="Entries counted" value={totalEntries} hint="all cities incl. Other" />
            </div>
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Completed rounds per day</h2>
            {(stats?.daily ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">No completed rounds in this period yet.</p>
            ) : (
              <ul className="mt-4 space-y-1.5">
                {(stats?.daily ?? []).map((d) => (
                  <li key={d.day} className="flex items-center gap-3 text-xs">
                    <span className="w-20 flex-none font-semibold text-ink-700">{d.day.slice(5)}</span>
                    <span className="h-3 rounded-full bg-teal-600" style={{ width: `${Math.max(2, (d.completes * 100) / maxDaily)}%` }} />
                    <span className="font-extrabold text-ink-900">{d.completes}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Cities</h2>
            <p className="mt-1 text-xs text-ink-500">Exact entries, average Habit Score and gender split for the period.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-extrabold text-ink-500">
                    <th className="py-2 pr-3">City</th>
                    <th className="py-2 pr-3 text-right">Entries</th>
                    <th className="py-2 pr-3 text-right">Avg score</th>
                    <th className="py-2 pr-3 text-right">Female</th>
                    <th className="py-2 pr-3 text-right">Male</th>
                    <th className="py-2 text-right">Not said</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.cities ?? []).map((c) => (
                    <tr key={`${c.city_id}`} className="border-t border-[#e3efec]">
                      <td className="py-2 pr-3 font-bold text-ink-900">
                        {c.name} {c.province && <span className="text-xs font-semibold text-ink-500">· {c.province}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-extrabold">{c.entries}</td>
                      <td className="py-2 pr-3 text-right">{c.avg_score ?? "-"}</td>
                      <td className="py-2 pr-3 text-right">{c.female}</td>
                      <td className="py-2 pr-3 text-right">{c.male}</td>
                      <td className="py-2 text-right">{c.unsaid}</td>
                    </tr>
                  ))}
                  {(stats?.cities ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-sm text-ink-500">No entries in this period yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Weekly winners</h2>
            {draft ? (
              <>
                <p className="mt-1 text-xs text-ink-500">
                  Last finished week: {weekLabel(draft.week_start)}. A city needs at least {draft.min_entries} entries that week.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[#f5faf8] p-4">
                    <div className="text-[11px] font-extrabold tracking-[0.14em] text-ink-500">CITY OF THE WEEK</div>
                    <div className="mt-1 text-lg font-extrabold text-ink-900">{draft.best ? draft.best.name : "No city qualified"}</div>
                    {draft.best && <div className="text-xs text-ink-700">{draft.best.province} · average score {draft.best.score}</div>}
                  </div>
                  <div className="rounded-2xl bg-[#f5faf8] p-4">
                    <div className="text-[11px] font-extrabold tracking-[0.14em] text-ink-500">MOST IMPROVED</div>
                    <div className="mt-1 text-lg font-extrabold text-ink-900">{draft.improved ? draft.improved.name : "No city qualified"}</div>
                    {draft.improved && <div className="text-xs text-ink-700">{draft.improved.province} · up {draft.improved.delta} points</div>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {draft.published ? (
                    <>
                      <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-extrabold text-teal-800">Published</span>
                      <button type="button" disabled={busy} onClick={() => unpublish(draft.week_start)} className="rounded-full border border-red-200 px-4 py-2 text-xs font-extrabold text-red-700 hover:bg-red-50">
                        Hide from public
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || (!draft.best && !draft.improved)}
                      onClick={() => publish(draft.week_start)}
                      className="rounded-full bg-teal-700 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:bg-[#b9d3cd]"
                    >
                      Publish winners
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-500">Winners will appear here once a week has finished.</p>
            )}
            {publishedWeeks.length > 0 && (
              <p className="mt-4 text-xs text-ink-500">Published weeks: {publishedWeeks.map((w) => weekLabel(w)).join(" · ")}</p>
            )}
          </div>
        </>
      )}

      {tab === "cities" && (
        <div className={CARD}>
          <h2 className="text-lg font-extrabold text-ink-900">Cities</h2>
          <p className="mt-1 text-xs text-ink-500">
            Switch a city off to hide it from the picker. Cities are never deleted, so their past totals stay in the stats.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="block text-xs font-semibold text-ink-700">
              Add a city
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="City name" className={INPUT} />
            </label>
            <label className="block text-xs font-semibold text-ink-700">
              Province
              <select value={newProvince} onChange={(e) => setNewProvince(e.target.value)} className={INPUT}>
                {PROVINCE_CHIPS.map((p) => (
                  <option key={p.value} value={p.value}>{p.value}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={addCity} className="self-end rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800">
              Add
            </button>
          </div>
          <input
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            placeholder="Search the list"
            className="mt-5 block w-full rounded-md border border-[#d7e7e2] px-3 py-2 text-sm"
          />
          <ul className="mt-3 divide-y divide-[#e3efec]">
            {shownCities.slice(0, 80).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className={`text-sm font-bold ${c.is_active ? "text-ink-900" : "text-ink-400 line-through"}`}>
                  {c.name} <span className="text-xs font-semibold text-ink-500">· {c.province}</span>
                </span>
                <button type="button" onClick={() => toggleCity(c)} className="rounded-full border border-[#d7e7e2] px-3 py-1 text-xs font-extrabold text-ink-700 hover:bg-[#f5faf8]">
                  {c.is_active ? "Switch off" : "Switch on"}
                </button>
              </li>
            ))}
          </ul>
          {shownCities.length > 80 && <p className="mt-3 text-xs text-ink-500">Showing the first 80 matches. Type to narrow the list.</p>}
        </div>
      )}
    </div>
  );
}

export default function AdminHabitAge() {
  return (
    <AdminGuard title="Habit Age game">
      {() => (
        <div>
          <PageHeader title="Habit Age game" subtitle="Settings, visitors and weekly winners for the Habit Age quiz and city league." />
          <Inner />
        </div>
      )}
    </AdminGuard>
  );
}
