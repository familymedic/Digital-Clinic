import Link from "next/link";
import SponsoredAdSlot from "@/components/SponsoredAdSlot";

const steps = [
  {
    n: "1",
    title: "Tell us what's bothering you",
    body: "Answer a short set of guided questions, or record a voice note in your own words — your choice.",
  },
  {
    n: "2",
    title: "Your doctor reviews it",
    body: "Your doctor personally reviews your complaint and history before your consultation begins.",
  },
  {
    n: "3",
    title: "Have your consultation",
    body: "Meet by video, audio, or text — whichever you prefer — and receive a clear assessment and, when appropriate, a prescription or advice.",
  },
];

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const trustPoints = [
  {
    title: "PMDC-verified doctors",
    body: "Every physician is checked against PMDC records before they ever see a patient on the platform.",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Never automated",
    body: "Your doctor reviews your information and makes every clinical decision themselves — diagnoses and prescriptions are never generated automatically.",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    title: "Care for the whole family",
    body: "Add every family member to one account — children included — and book any of them a consultation.",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M15 14.5c2.5.3 4.5 2.4 4.5 5.5" />
      </svg>
    ),
  },
  {
    title: "Private, every time",
    body: "Your records are scoped to your own account and only ever visible to you and the doctor treating you.",
    icon: (
      <svg {...iconProps}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
];

const complaints = [
  "Fever",
  "Cough",
  "Sore throat",
  "Abdominal pain",
  "Diarrhea / vomiting",
  "Headache",
  "Back pain",
  "Urinary symptoms",
  "Shortness of breath",
  "Chest pain",
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[520px]"
          style={{
            background:
              "radial-gradient(900px 420px at 78% 0%, var(--color-teal-100) 0%, transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800">
                Digital Family Clinic
              </span>
              <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
                Your family doctor, available digitally
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-700 sm:text-lg">
                Talk to a real family physician online — by video, audio, or
                text, whichever suits you. Tell us about your symptoms and
                health concerns before your visit so your doctor can review
                them; every clinical decision remains your doctor&rsquo;s.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/book"
                  className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-6 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:from-teal-700 hover:to-teal-800"
                >
                  Book a Consultation
                </Link>
                <Link
                  href="/how-it-works"
                  className="rounded-full border border-ink-border bg-white px-6 py-3.5 text-center text-sm font-semibold text-ink-900 transition hover:border-teal-700 hover:text-teal-700"
                >
                  See how it works
                </Link>
              </div>
            </div>

            {/* Illustrated consultation card — not a photo */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative w-full max-w-sm">
                <div className="absolute inset-0 rotate-3 rounded-[28px] bg-gradient-to-br from-teal-600 to-brand-950 shadow-xl" />
                <div className="relative flex flex-col gap-4 rounded-[28px] bg-white p-6 shadow-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-500">
                      Today&rsquo;s consultation
                    </span>
                    <span className="rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold text-teal-700">
                      Video
                    </span>
                  </div>
                  <div className="relative flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0a2e2b] to-[#123f3a]">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-700 text-lg font-bold text-white">
                      DR
                    </div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="text-[11px] font-semibold text-white">Connected</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-ink-900">Fever &amp; sore throat</div>
                      <div className="text-xs text-ink-500">3-day history reviewed</div>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 8.5l-6 4 6 4v-8z" /><rect x="2" y="6" width="14" height="12" rx="2" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-ink-border bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-8 sm:grid-cols-3 sm:px-6">
          <div className="flex items-center gap-4 rounded-2xl border border-ink-border p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </span>
            <div>
              <p className="text-xl font-extrabold text-teal-700">Transparent Pricing</p>
              <p className="text-xs text-ink-500">Set by your doctor, shown before you book</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-ink-border p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 7h7l-5.6 4.3L18.4 21 12 16.8 5.6 21l1.9-7.7L2 9h7z" />
              </svg>
            </span>
            <div>
              <p className="text-xl font-extrabold text-teal-700">Physician-led</p>
              <p className="text-xs text-ink-500">Every clinical decision is your doctor&rsquo;s</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-ink-border p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </span>
            <div>
              <p className="text-xl font-extrabold text-teal-700">Your choice</p>
              <p className="text-xs text-ink-500">Guided questions or a voice note; video, audio, or text</p>
            </div>
          </div>
        </div>
      </section>

      <SponsoredAdSlot />

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-lg text-center">
          <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
            Simple, guided process
          </span>
          <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            How it works
          </h2>
        </div>
        <div className="relative mt-12 grid gap-6 sm:grid-cols-3">
          <div className="absolute left-[16%] right-[16%] top-[26px] hidden h-px border-t-2 border-dashed border-ink-border sm:block" />
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative rounded-2xl border border-ink-border bg-white p-7 shadow-sm"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-base font-extrabold text-white shadow-sm">
                {s.n}
              </span>
              <h3 className="mt-5 text-base font-bold text-ink-900">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* "How it works" walkthrough video (2026-09-24) — a short,
          silent screen-capture-style clip of the real app (sample
          names only, no real patient data) showing registration,
          adding a family member, and booking a consultation, so a
          patient who'd rather watch than read the three steps above
          can. Plain <video> with a poster frame and native controls —
          no external player/library needed for one short local clip.
          Physician asked for this 2026-09-24 ("can we generate a
          video... to show patients how to register themselves and
          families and how to book an appointment"). */}
      <section className="mx-auto max-w-4xl px-4 pb-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-ink-border bg-white shadow-sm">
          <div className="border-b border-ink-border px-6 py-5 text-center">
            <h3 className="text-base font-bold text-ink-900">
              Prefer to watch? Here&rsquo;s a 30-second walkthrough
            </h3>
            <p className="mt-1 text-sm text-ink-500">
              Creating your account, adding a family member, and booking a consultation.
            </p>
          </div>
          <video
            controls
            playsInline
            preload="none"
            poster="/how-it-works-poster.jpg"
            className="block w-full bg-black"
          >
            <source src="/how-it-works-walkthrough.mp4" type="video/mp4" />
            Your browser doesn&rsquo;t support embedded video — the three steps above cover the same process.
          </video>
        </div>
      </section>

      {/* Why families trust us — replaces the old single-doctor spotlight
          (2026-09-24). That section always needed one specific doctor's
          real name/photo/bio to not look like a placeholder, which meant
          it would need editing again the moment that doctor changed or a
          second doctor joined. This describes the platform itself
          instead — nothing here needs to be swapped out as the team
          grows, and every claim below is something the app actually
          does today (checked against the codebase, not just written):
          PMDC verification is a real gate before a doctor goes live
          (assign_default_doctor / public_doctor_directory, 0028);
          "never automated" matches the footer's own existing tagline;
          family-member support and per-account RLS scoping are both
          real, existing features. */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-brand-950 to-[#072522] p-10 shadow-xl sm:p-14">
          <div
            className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(20,184,166,0.28), transparent 70%)" }}
          />
          <div className="relative text-center">
            <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-teal-200">
              Why families choose us
            </span>
            <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-extrabold text-white sm:text-3xl">
              Real doctors, reviewing every case personally
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/70">
              Every consultation on Family Medic is handled by a verified, licensed physician — never an automated
              system.
            </p>
          </div>

          <div className="relative mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {trustPoints.map((t) => (
              <div key={t.title} className="rounded-2xl bg-white/5 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500/20 text-teal-300">
                  {t.icon}
                </div>
                <p className="mt-3 text-sm font-semibold text-white">{t.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">{t.body}</p>
              </div>
            ))}
          </div>

          <div className="relative mt-10 text-center">
            <Link
              href="/doctors"
              className="inline-block rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-brand-950 shadow-sm transition hover:bg-teal-50"
            >
              View all our doctors →
            </Link>
          </div>
        </div>
      </section>

      {/* Common complaints */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Common reasons patients visit us
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-500">
            We take a focused history for each type of complaint, so your
            doctor has what they need before you even meet.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {complaints.map((c) => (
              <span
                key={c}
                className="rounded-full border border-ink-border bg-[var(--background)] px-4 py-2 text-sm font-semibold text-ink-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Doctor-led, always */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
          Doctor-led, always
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-500 sm:text-base">
          Before your consultation, we ask about your symptoms and health
          history so your doctor has everything they need. Your doctor
          reviews it personally — they diagnose, prescribe, and decide,
          always.
        </p>
      </section>

      {/* CTA banner */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-center gap-6 rounded-[28px] border border-ink-border bg-white p-10 shadow-sm sm:flex-row sm:justify-between sm:p-14 sm:text-left text-center">
          <div>
            <h3 className="text-xl font-extrabold text-ink-900 sm:text-2xl">
              Ready to talk to a doctor today?
            </h3>
            <p className="mt-2 text-sm text-ink-500">
              Tell us about your symptoms — every clinical decision stays
              your doctor&rsquo;s.
            </p>
          </div>
          <Link
            href="/book"
            className="shrink-0 rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:from-teal-700 hover:to-teal-800"
          >
            Book a Consultation
          </Link>
        </div>
      </section>
    </div>
  );
}
