import Link from "next/link";
import PageHeader from "@/components/PageHeader";

// Free calculators (2026-09-15): a lead-generation/SEO play the physician
// asked to add — simple, well-established medical reference formulas
// (no AI, no patient data, no login) that double as a soft on-ramp into
// booking a real consultation. Each tool lives at its own route so it can
// be linked to/indexed individually; this page is just the directory.
// Deliberately does NOT include anything that calculates a medication
// dose, interaction, or treatment plan — a plain reference formula
// reporting a number is a different risk category from something that
// could be read as "take this much of X," which stays physician-gated
// per this project's standing clinical-safety principle.

const tools = [
  {
    href: "/calculators/bmi",
    title: "BMI Calculator",
    description: "Estimate your Body Mass Index from your height and weight, using the standard WHO adult categories.",
  },
  {
    href: "/calculators/due-date",
    title: "Pregnancy Due Date Calculator",
    description: "Estimate your expected delivery date and current gestational age from your last menstrual period.",
  },
];

export default function CalculatorsHub() {
  return (
    <div>
      <PageHeader
        title="Free Health Calculators"
        subtitle="Quick, well-established reference tools — free to use, no account needed. These are general estimates, not a diagnosis; your doctor can give you a full, personal assessment."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex flex-col rounded-2xl border border-ink-border bg-white p-6 shadow-sm transition hover:border-teal-600"
            >
              <span className="text-base font-bold text-ink-900">{t.title}</span>
              <span className="mt-2 text-sm leading-relaxed text-ink-500">{t.description}</span>
              <span className="mt-4 text-sm font-semibold text-teal-700">Open calculator →</span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-xs text-ink-400">
          More free tools are planned. Have a suggestion?{" "}
          <Link href="/contact" className="font-semibold text-teal-700 underline underline-offset-2">
            Let us know
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
