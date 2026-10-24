"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { PROVINCE_CHIPS, fetchLeague, provinceLabel, weekLabel, type LeaguePayload } from "@/lib/habitAge";

// Habit Age city league: average Habit Score per city over the last 7 days,
// compared with the 7 days before. Entry counts appear only when the admin
// has switched them on, and then as exact numbers.

const PAGE_SIZE = 20;

export default function LeaguePage() {
  const [data, setData] = useState<LeaguePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [province, setProvince] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    void fetchLeague().then((d) => {
      if (cancelled) return;
      setData(d);
      setState(d ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const league = data?.league;
  const rows = useMemo(() => {
    const all = league?.cities ?? [];
    return province ? all.filter((c) => c.province === province) : all;
  }, [league, province]);
  const latest = data?.winners?.[0];
  const showCounts = league?.show_counts === true;

  return (
    <div>
      <PageHeader
        title="City league"
        subtitle="Which city has the best everyday habits? Average Habit Score of each city over the last 7 days."
      />
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        {state === "loading" && <p className="text-center text-sm font-semibold text-ink-500">Loading the league…</p>}
        {state === "failed" && (
          <p className="rounded-2xl bg-[#fff6e8] p-4 text-center text-sm font-semibold text-[#7a4a00]">
            The league is not available right now. Please try again in a little while.
          </p>
        )}

        {league && !league.league_live && (
          <div className="rounded-[28px] border border-[#dcebe6] bg-white p-6 text-center">
            <p className="text-lg font-extrabold text-ink-900">The city league is coming soon</p>
            <p className="mt-2 text-sm text-ink-500">Play Habit Age now and your city will be ready when it opens.</p>
          </div>
        )}

        {league && league.league_live && (
          <>
            {latest?.best && (
              <div className="mb-5 flex items-center gap-4 rounded-[28px] bg-gradient-to-br from-teal-700 to-[#0b4540] p-5 text-white shadow-[0_18px_40px_-28px_rgba(7,41,39,0.6)]">
                <span className="grid h-16 w-16 flex-none place-items-center rounded-full bg-[#ffb454] text-3xl text-[#3b2500]" aria-hidden="true">
                  ★
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-100/80">
                    CITY OF THE WEEK · {weekLabel(latest.week_start).toUpperCase()}
                  </p>
                  <p className="truncate text-2xl font-extrabold">{latest.best.name}</p>
                  <p className="text-sm font-semibold text-teal-100/90">
                    {latest.best.province} · average score {latest.best.score}
                  </p>
                </div>
              </div>
            )}

            <div className="-mx-1 mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={province === null}
                onClick={() => {
                  setProvince(null);
                  setShown(PAGE_SIZE);
                }}
                className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition ${
                  province === null ? "border-teal-700 bg-[#e6f5f2] text-ink-900" : "border-[#d2e9e5] bg-white text-ink-700"
                }`}
              >
                All
              </button>
              {PROVINCE_CHIPS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={province === p.value}
                  onClick={() => {
                    setProvince(province === p.value ? null : p.value);
                    setShown(PAGE_SIZE);
                  }}
                  className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition ${
                    province === p.value ? "border-teal-700 bg-[#e6f5f2] text-ink-900" : "border-[#d2e9e5] bg-white text-ink-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="rounded-[28px] border border-[#dcebe6] bg-white p-6 text-center">
                <p className="text-base font-extrabold text-ink-900">No scores here yet</p>
                <p className="mt-1 text-sm text-ink-500">Be the first to play for your city this week.</p>
              </div>
            ) : (
              <ol className="grid gap-2.5" data-testid="league-rows">
                {rows.slice(0, shown).map((c, i) => {
                  const delta = typeof c.delta === "number" ? c.delta : null;
                  return (
                    <li
                      key={c.city_id}
                      className="flex items-center gap-3 rounded-2xl border-2 border-[#dcebe6] bg-white px-4 py-3"
                    >
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[#d9efec] text-base font-extrabold text-ink-900">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-extrabold text-ink-900">{c.name}</p>
                        <p className="text-xs font-bold text-teal-700">
                          {provinceLabel(c.province)}
                          {showCounts && typeof c.entries === "number" && (
                            <span className="ml-2 font-semibold text-ink-500">
                              · {c.entries} {c.entries === 1 ? "entry" : "entries"}
                            </span>
                          )}
                        </p>
                      </div>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`text-xs font-extrabold ${delta > 0 ? "text-teal-700" : "text-ink-400"}`}
                          title="Compared with the week before"
                        >
                          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
                        </span>
                      )}
                      <span className="min-w-[2.5rem] text-right text-2xl font-extrabold text-ink-900">{c.avg}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {rows.length > shown && (
              <button
                type="button"
                onClick={() => setShown(shown + PAGE_SIZE)}
                className="mt-4 w-full rounded-full border-2 border-teal-700/25 bg-white px-6 py-3 text-sm font-bold text-teal-800"
              >
                Show more cities
              </button>
            )}

            <p className="mt-5 text-center text-xs leading-relaxed text-ink-400">
              Score is the average Habit Score of everyone who played for the city in the last 7 days. The arrow compares
              it with the 7 days before. City of the Week needs at least {league.min_entries} entries.
            </p>
          </>
        )}

        <div className="mt-6 grid gap-3">
          <Link
            href="/habit-age"
            className="inline-flex w-full items-center justify-center rounded-full bg-teal-700 px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-teal-800"
          >
            Play for your city
          </Link>
          <Link href="/habit-age/winners" className="text-center text-sm font-bold text-teal-700 underline underline-offset-4">
            Past weekly winners
          </Link>
        </div>
        <p className="mt-5 text-center text-xs text-ink-400">
          A fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    </div>
  );
}
