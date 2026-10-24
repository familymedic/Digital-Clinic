import Link from "next/link";

// Free tools hub. Redesigned 2026-10 (modern look): a bold hero, a featured
// card for the Habit Age game, and icon cards for the reference calculators.
// Each tool lives at its own route so it can be linked to and indexed on its
// own; this page is just the front door.
//
// Calculators deliberately do NOT include anything that works out a
// medication dose, interaction or treatment plan: a plain reference formula
// that reports a number is a different risk category from something that
// could be read as "take this much of X", which stays physician-gated per
// this project's standing clinical-safety principle. Habit Age is a FUN
// estimate of daily habits and is always labelled as not a medical assessment.

const tools = [
  {
    href: "/calculators/bmi",
    title: "BMI Calculator",
    description: "Estimate your Body Mass Index from your height and weight, using the standard WHO adult categories.",
    cta: "Open calculator",
    tint: "from-[#e6f5f2] to-[#cfeee8]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M7 9h2M11 9h2M15 9h2M7 13h10M7 16.5h6" />
      </svg>
    ),
  },
  {
    href: "/calculators/due-date",
    title: "Pregnancy Due Date Calculator",
    description: "Estimate your expected delivery date and current gestational age from your last menstrual period.",
    cta: "Open calculator",
    tint: "from-[#fff3dc] to-[#ffe5b8]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="M12 18s-3-1.8-3-3.8c0-1.1.8-1.9 1.8-1.9.6 0 1 .3 1.2.7.2-.4.6-.7 1.2-.7 1 0 1.8.8 1.8 1.9 0 2-3 3.8-3 3.8z" />
      </svg>
    ),
  },
];

const perks = ["Free to use", "No account needed", "Nothing personal stored"];

export default function CalculatorsHub() {
  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-b-[40px] bg-[radial-gradient(900px_380px_at_90%_-20%,rgba(45,212,191,0.32),transparent_60%),radial-gradient(500px_260px_at_0%_110%,rgba(255,180,84,0.16),transparent_65%),linear-gradient(180deg,#0a3733,#072927)]">
        <div className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold tracking-[0.14em] text-teal-100">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffb454]" aria-hidden="true" />
            FREE HEALTH TOOLS
          </span>
          <h1 className="mt-5 max-w-2xl text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-[46px]">
            Small tools for <span className="text-[#ffb454]">everyday</span> health questions
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-teal-100/85 sm:text-lg">
            Quick, simple and free. Play a fun habits quiz, or use a trusted reference calculator. These are general
            estimates, not a diagnosis. A family doctor can give you a full, personal assessment.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {perks.map((p) => (
              <li key={p} className="rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-bold text-teal-50 sm:text-sm">
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto -mt-10 max-w-5xl px-4 pb-14 sm:-mt-12 sm:px-6">
        {/* Featured: Habit Age */}
        <Link
          href="/habit-age"
          className="group relative block overflow-hidden rounded-[32px] bg-[radial-gradient(600px_280px_at_100%_0%,rgba(45,212,191,0.28),transparent_60%),linear-gradient(150deg,#0f766e,#0a3733)] p-6 text-white shadow-[0_28px_60px_-30px_rgba(7,41,39,0.75)] transition hover:-translate-y-0.5 sm:p-9"
          data-testid="tools-habit-age"
        >
          <div className="grid items-center gap-6 sm:grid-cols-[1fr_auto] sm:gap-10">
            <div>
              <span className="inline-flex items-center rounded-full bg-[#ffb454] px-3 py-1 text-[11px] font-extrabold tracking-[0.14em] text-[#3b2500]">
                NEW · FUN QUIZ
              </span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Habit Age</h2>
              <p className="mt-1 text-lg font-bold text-[#ffb454] sm:text-xl">Your birthday says one age. Do your habits agree?</p>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-teal-50/90 sm:text-base">
                Answer 8 quick questions about sleep, walking, food and screens. Compare your real age with your Habit Age,
                then see which city in Pakistan has the best habits this week.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-extrabold text-[#0a3733] transition group-hover:bg-[#ffb454] sm:text-base">
                Play now
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
              <p className="mt-3 text-[11px] text-teal-100/70">A fun estimate of daily habits, not a medical assessment.</p>
            </div>
            <div className="relative mx-auto hidden h-44 w-44 sm:block" aria-hidden="true">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
                <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="14" />
                <circle cx="100" cy="100" r="84" fill="none" stroke="#ffb454" strokeWidth="14" strokeLinecap="round" strokeDasharray="400 528" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-extrabold leading-none">29</span>
                <span className="mt-1 text-[10px] font-bold tracking-[0.2em] text-teal-100/80">HABIT AGE</span>
              </div>
            </div>
          </div>
        </Link>

        <Link
          href="/habit-age/league"
          className="mt-3 flex items-center justify-between rounded-2xl border border-[#dcebe6] bg-white px-5 py-3.5 text-sm font-bold text-ink-900 transition hover:border-teal-600"
        >
          <span>See the city league: which city has the best habits?</span>
          <span className="text-teal-700" aria-hidden="true">→</span>
        </Link>

        {/* Calculators */}
        <h2 className="mt-10 text-xs font-extrabold tracking-[0.18em] text-teal-700">REFERENCE CALCULATORS</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group flex flex-col rounded-[28px] border border-[#dcebe6] bg-white p-6 shadow-[0_14px_34px_-24px_rgba(7,41,39,0.4)] transition hover:-translate-y-0.5 hover:border-teal-600"
            >
              <span className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${t.tint} text-teal-800`}>{t.icon}</span>
              <span className="mt-4 text-lg font-extrabold text-ink-900">{t.title}</span>
              <span className="mt-1.5 text-sm leading-relaxed text-ink-500">{t.description}</span>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-extrabold text-teal-700">
                {t.cta}
                <span className="transition group-hover:translate-x-0.5" aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>

        {/* Soft on-ramp to a real consultation */}
        <div className="mt-10 flex flex-col items-start gap-4 rounded-[28px] bg-[#fff6e8] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <p className="text-lg font-extrabold text-ink-900">Have a health question these tools can&apos;t answer?</p>
            <p className="mt-1 text-sm text-ink-700">Talk to a PMDC-verified family doctor by video, audio or text.</p>
          </div>
          <Link
            href="/book"
            className="inline-flex flex-none items-center justify-center rounded-full bg-teal-700 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-teal-800"
          >
            Book a doctor
          </Link>
        </div>

        <p className="mt-8 text-xs text-ink-400">
          More free tools are planned. Have a suggestion?{" "}
          <Link href="/contact" className="font-semibold text-teal-700 underline underline-offset-2">
            Let us know
          </Link>
          . Not for emergencies: in an emergency, go to the nearest hospital.
        </p>
      </div>
    </div>
  );
}
