"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

// BMI calculator (2026-09-15). Pure client-side arithmetic — no account,
// no data stored anywhere, nothing sent to the server. Category
// boundaries and all result copy below are the standard WHO adult BMI
// classification (physician-reviewed before publishing, same process as
// every other clinical-facing sentence on this site). Deliberately using
// the standard global WHO cutoffs rather than the lower Asian-population
// cutoffs some clinicians use — noted so this can be revisited if the
// physician prefers those instead.
type Category = "underweight" | "normal" | "overweight" | "obese";

function categorize(bmi: number): Category {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

const CATEGORY_LABEL: Record<Category, string> = {
  underweight: "Underweight",
  normal: "Normal weight",
  overweight: "Overweight",
  obese: "Obese",
};

const CATEGORY_STYLE: Record<Category, string> = {
  underweight: "border-amber-200 bg-amber-50 text-amber-900",
  normal: "border-teal-200 bg-teal-50 text-teal-900",
  overweight: "border-amber-200 bg-amber-50 text-amber-900",
  obese: "border-red-200 bg-red-50 text-red-900",
};

const CATEGORY_MESSAGE: Record<Category, string> = {
  underweight:
    "A family physician can help review your diet and check for an underlying cause.",
  normal:
    "You're in the WHO-defined healthy weight range — a family physician is still a good resource for any other health questions.",
  overweight:
    "A family physician can help you build a realistic, personalized plan.",
  obese:
    "A family physician can help you put together a safe, personalized plan and check for related health risks.",
};

export default function BMICalculator() {
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [result, setResult] = useState<{ bmi: number; category: Category } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function calculate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const h = Number(heightCm);
    const w = Number(weightKg);
    if (!h || !w || h <= 0 || w <= 0) {
      setError("Please enter a valid height and weight.");
      setResult(null);
      return;
    }
    if (h < 50 || h > 250) {
      setError("Please enter your height in centimetres (e.g. 165).");
      setResult(null);
      return;
    }
    const meters = h / 100;
    const bmi = w / (meters * meters);
    setResult({ bmi, category: categorize(bmi) });
  }

  return (
    <div>
      <PageHeader
        title="BMI Calculator"
        subtitle="Estimate your Body Mass Index (BMI) from your height and weight, using the standard WHO adult categories."
      />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <form onSubmit={calculate} className="space-y-5 rounded-2xl border border-ink-border bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="heightCm" className="block text-sm font-medium text-ink-700">
              Height (centimetres)
            </label>
            <input
              id="heightCm"
              type="number"
              inputMode="decimal"
              min={0}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 165"
              className="mt-1.5 block w-full rounded-md border border-ink-border px-3 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <div>
            <label htmlFor="weightKg" className="block text-sm font-medium text-ink-700">
              Weight (kilograms)
            </label>
            <input
              id="weightKg"
              type="number"
              inputMode="decimal"
              min={0}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 68"
              className="mt-1.5 block w-full rounded-md border border-ink-border px-3 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800"
          >
            Calculate BMI
          </button>
        </form>

        {result && (
          <div className={`mt-6 rounded-2xl border p-5 ${CATEGORY_STYLE[result.category]}`}>
            <div className="text-3xl font-extrabold">{result.bmi.toFixed(1)}</div>
            <div className="mt-1 text-sm font-bold">{CATEGORY_LABEL[result.category]}</div>
            <p className="mt-3 text-sm leading-relaxed">{CATEGORY_MESSAGE[result.category]}</p>
            <Link
              href="/book"
              className="mt-4 inline-block rounded-full bg-white/80 px-4 py-2 text-xs font-semibold text-ink-900 shadow-sm hover:bg-white"
            >
              Book a consultation →
            </Link>
          </div>
        )}

        <div className="mt-8 space-y-3 text-xs leading-relaxed text-ink-400">
          <p>
            <span className="font-semibold text-ink-500">WHO adult BMI categories:</span>{" "}
            below 18.5 underweight · 18.5–24.9 normal weight · 25–29.9 overweight · 30 and above obese.
          </p>
          <p>
            BMI is a general screening measure, not a diagnosis — it doesn&rsquo;t account for muscle
            mass, body frame, age, or pregnancy, and shouldn&rsquo;t be used alone to judge anyone&rsquo;s
            health. For a full, personal assessment, please talk to a doctor.
          </p>
        </div>
      </div>
    </div>
  );
}
