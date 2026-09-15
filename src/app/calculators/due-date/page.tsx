"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

// Pregnancy due-date calculator (2026-09-15). Pure client-side arithmetic
// — no account, no data stored anywhere, nothing sent to the server.
// Uses Naegele's rule (LMP + 280 days), adjusted for a reported average
// cycle length other than the standard 28 days — the same standard
// obstetric estimation method used worldwide. All result copy below is
// physician-reviewed before publishing, same as every other clinical-
// facing sentence on this site, and is deliberately framed as an
// estimate throughout, never a confirmed date.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

interface Result {
  dueDate: Date;
  gestationWeeks: number;
  gestationDays: number;
  trimester: 1 | 2 | 3;
}

export default function DueDateCalculator() {
  const [lmp, setLmp] = useState("");
  const [cycleLength, setCycleLength] = useState("28");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function calculate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);

    if (!lmp) {
      setError("Please enter the first day of your last menstrual period.");
      setResult(null);
      return;
    }
    const lmpDate = new Date(`${lmp}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (Number.isNaN(lmpDate.getTime())) {
      setError("Please enter a valid date.");
      setResult(null);
      return;
    }
    if (lmpDate > today) {
      setError("That date is in the future — please enter the first day of your last period.");
      setResult(null);
      return;
    }

    const cycle = Number(cycleLength) || 28;
    if (cycle < 20 || cycle > 45) {
      setError("Please enter a typical cycle length in days (usually between 21 and 35).");
      setResult(null);
      return;
    }

    const dueDate = addDays(lmpDate, 280 + (cycle - 28));
    const daysPregnant = Math.floor((today.getTime() - lmpDate.getTime()) / MS_PER_DAY);
    const gestationWeeks = Math.floor(daysPregnant / 7);
    const gestationDays = daysPregnant % 7;
    const trimester: 1 | 2 | 3 = gestationWeeks < 13 ? 1 : gestationWeeks < 27 ? 2 : 3;

    if (gestationWeeks > 42) {
      setNote(
        "That's well beyond a typical 40-week pregnancy — please double-check the date you entered, or speak with your doctor if it's correct."
      );
    }

    setResult({ dueDate, gestationWeeks, gestationDays, trimester });
  }

  return (
    <div>
      <PageHeader
        title="Pregnancy Due Date Calculator"
        subtitle="Estimate your due date and current stage of pregnancy from the first day of your last menstrual period (LMP), using the standard obstetric estimation method."
      />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <form onSubmit={calculate} className="space-y-5 rounded-2xl border border-ink-border bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="lmp" className="block text-sm font-medium text-ink-700">
              First day of your last period
            </label>
            <input
              id="lmp"
              type="date"
              value={lmp}
              onChange={(e) => setLmp(e.target.value)}
              className="mt-1.5 block w-full rounded-md border border-ink-border px-3 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <div>
            <label htmlFor="cycleLength" className="block text-sm font-medium text-ink-700">
              Average cycle length (days)
            </label>
            <input
              id="cycleLength"
              type="number"
              inputMode="numeric"
              value={cycleLength}
              onChange={(e) => setCycleLength(e.target.value)}
              placeholder="28"
              className="mt-1.5 block w-full rounded-md border border-ink-border px-3 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
            <p className="mt-1 text-xs text-ink-400">Leave as 28 if you&rsquo;re not sure — that&rsquo;s the typical average.</p>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800"
          >
            Calculate due date
          </button>
        </form>

        {result && (
          <div className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 text-teal-900">
            <div className="text-xs font-bold uppercase tracking-wide text-teal-700">Estimated due date</div>
            <div className="mt-1 text-xl font-extrabold">{formatDate(result.dueDate)}</div>
            <p className="mt-3 text-sm leading-relaxed">
              You&rsquo;re about <span className="font-semibold">{result.gestationWeeks} weeks and {result.gestationDays} days</span> along today
              — in your <span className="font-semibold">{result.trimester === 1 ? "first" : result.trimester === 2 ? "second" : "third"} trimester</span>.
            </p>
            {note && <p className="mt-3 text-sm font-medium text-amber-800">{note}</p>}
            <Link
              href="/book"
              className="mt-4 inline-block rounded-full bg-white/80 px-4 py-2 text-xs font-semibold text-ink-900 shadow-sm hover:bg-white"
            >
              Book a consultation to confirm dating and start antenatal care →
            </Link>
          </div>
        )}

        <div className="mt-8 space-y-3 text-xs leading-relaxed text-ink-400">
          <p>
            This is an estimate based on a standard 280-day (40-week) pregnancy length counted from
            the first day of your last period, adjusted for your reported cycle length. Actual delivery
            dates commonly vary by up to two weeks in either direction.
          </p>
          <p>
            If your cycle is irregular, you&rsquo;re unsure of your last period, or an ultrasound has
            given a different date, the ultrasound dating is generally more accurate — please discuss
            this with your doctor.
          </p>
        </div>
      </div>
    </div>
  );
}
