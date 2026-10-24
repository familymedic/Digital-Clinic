"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { fetchLeague, trackHabitEvent, weekLabel, type WinnerWeek } from "@/lib/habitAge";
import { drawWinnerCard, shareOrDownloadCard } from "@/lib/habitCards";

// Past weekly winners (published by the admin, or automatically when the
// admin has switched auto-publish on). A winner card can be shared as a picture.

export default function WinnersPage() {
  const [winners, setWinners] = useState<WinnerWeek[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLeague().then((d) => {
      if (cancelled) return;
      setWinners(d?.winners ?? []);
      setState(d ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCard(w: WinnerWeek) {
    setOpenWeek(w.week_start);
    setMsg(null);
    setTimeout(() => {
      if (canvasRef.current) {
        void drawWinnerCard(canvasRef.current, {
          weekStart: w.week_start,
          best: w.best,
          improved: w.improved,
        });
      }
    }, 0);
  }

  async function share() {
    if (!canvasRef.current) return;
    setBusy(true);
    const outcome = await shareOrDownloadCard(
      canvasRef.current,
      "habit-age-city-of-the-week.png",
      "City of the Week on Family Medic Habit Age. Is your city next?"
    );
    setBusy(false);
    if (outcome === "shared" || outcome === "downloaded") trackHabitEvent("share");
    setMsg(
      outcome === "shared"
        ? "Shared. Thank you!"
        : outcome === "downloaded"
          ? "Saved to your phone."
          : outcome === "cancelled"
            ? null
            : "Sorry, we could not make the picture. Please try again."
    );
  }

  return (
    <div>
      <PageHeader title="Weekly winners" subtitle="Every week we crown the city with the best habits and the city that improved the most." />
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        {state === "loading" && <p className="text-center text-sm font-semibold text-ink-500">Loading…</p>}
        {state === "failed" && (
          <p className="rounded-2xl bg-[#fff6e8] p-4 text-center text-sm font-semibold text-[#7a4a00]">
            Winners are not available right now. Please try again in a little while.
          </p>
        )}
        {state === "ready" && winners.length === 0 && (
          <div className="rounded-[28px] border border-[#dcebe6] bg-white p-6 text-center">
            <p className="text-lg font-extrabold text-ink-900">The first winners are coming soon</p>
            <p className="mt-2 text-sm text-ink-500">
              A city needs enough entries in a week to be considered. Play Habit Age and help your city get there.
            </p>
          </div>
        )}

        <div className="grid gap-4" data-testid="winner-weeks">
          {winners.map((w) => (
            <section key={w.week_start} className="rounded-[28px] border border-[#dcebe6] bg-white p-5 shadow-[0_18px_40px_-28px_rgba(7,41,39,0.45)]">
              <p className="text-xs font-extrabold tracking-[0.16em] text-teal-700">WEEK OF {weekLabel(w.week_start).toUpperCase()}</p>
              {w.best && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-[#ffb454] text-xl text-[#3b2500]" aria-hidden="true">★</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold tracking-[0.14em] text-ink-400">CITY OF THE WEEK</p>
                    <p className="truncate text-xl font-extrabold text-ink-900">{w.best.name}</p>
                    <p className="text-sm font-semibold text-ink-500">
                      {w.best.province} · average score {w.best.score}
                    </p>
                  </div>
                </div>
              )}
              {w.improved && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-[#d9efec] text-xl text-teal-800" aria-hidden="true">▲</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold tracking-[0.14em] text-ink-400">MOST IMPROVED</p>
                    <p className="truncate text-xl font-extrabold text-ink-900">{w.improved.name}</p>
                    <p className="text-sm font-semibold text-ink-500">
                      {w.improved.province} · up {w.improved.delta} points
                    </p>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => openCard(w)}
                className="mt-4 w-full rounded-full border-2 border-teal-700/25 bg-white px-5 py-2.5 text-sm font-bold text-teal-800 hover:border-teal-700"
              >
                Share this winner card
              </button>
              {openWeek === w.week_start && (
                <div className="mt-3 rounded-2xl bg-[#0a3733] p-3">
                  <canvas ref={canvasRef} className="mx-auto w-full max-w-[320px] rounded-xl" aria-label="Weekly winner card" />
                  <button
                    type="button"
                    onClick={share}
                    disabled={busy}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-[#ffb454] px-6 py-3 text-base font-extrabold text-[#3b2500] disabled:opacity-60"
                  >
                    {busy ? "Getting your card ready…" : "Share or save picture"}
                  </button>
                  {msg && <p className="mt-2 text-center text-sm font-semibold text-teal-100">{msg}</p>}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-6 grid gap-3">
          <Link
            href="/habit-age"
            className="inline-flex w-full items-center justify-center rounded-full bg-teal-700 px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-teal-800"
          >
            Play Habit Age
          </Link>
          <Link href="/habit-age/league" className="text-center text-sm font-bold text-teal-700 underline underline-offset-4">
            See the city league
          </Link>
        </div>
        <p className="mt-5 text-center text-xs text-ink-400">
          A fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    </div>
  );
}
