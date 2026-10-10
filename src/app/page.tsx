import Link from "next/link";
import SponsoredAdSlot from "@/components/SponsoredAdSlot";
import FeaturedReviews from "@/components/FeaturedReviews";
import HeroDoctorSpotlight from "@/components/HeroDoctorSpotlight";
import AppInstallSection from "@/components/AppInstallSection";

// New look (2026-10): dark-teal hero with a rotating doctor card, clear
// patient/doctor front doors, a free-app section, and the same sponsor
// slot, walkthrough video, trust section and featured reviews as before.
// The guided-questions step was removed from the copy — that
// questionnaire was retired on 2026-10-06 and the doctor takes the
// history directly.

const steps = [
  {
    n: "01",
    numClass: "text-teal-200",
    title: "Choose your doctor",
    body: "See each doctor’s fee and next available time before you book.",
  },
  {
    n: "02",
    numClass: "text-teal-300",
    title: "Pick a time that suits you",
    body: "Book a slot, pay securely, and meet at your chosen time.",
  },
  {
    n: "03",
    numClass: "text-[#ffb454]",
    title: "Meet your doctor",
    body: "Video, audio or text. Leave with clear advice and, when appropriate, a prescription.",
    dark: true,
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

const trustStrip = [
  {
    title: "PMDC-verified",
    body: "Checked against PMDC records.",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Your doctor decides",
    body: "Every clinical decision is human.",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a3 3 0 1 0 0-6M21 20c0-2.5-1.6-4.6-4-5.5" />
      </svg>
    ),
  },
  {
    title: "Price shown first",
    body: "Set by your doctor.",
    icon: (
      <svg {...iconProps}>
        <path d="M3 12V4h8l10 10-8 8z" />
        <circle cx="7.5" cy="8.5" r="1.3" />
      </svg>
    ),
  },
  {
    title: "Private by design",
    body: "Only you and your doctor.",
    icon: (
      <svg {...iconProps}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
];

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

const visitTypes = [
  {
    t: "Video",
    d: "Face to face, the closest to a clinic visit.",
    featured: true,
    icon: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3z" />
      </>
    ),
  },
  {
    t: "Audio",
    d: "A phone-style call when video isn’t convenient.",
    icon: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  },
  {
    t: "Text",
    d: "Message your doctor on your own time.",
    icon: <path d="M4 5h16v11H9l-5 4z" />,
  },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-[radial-gradient(900px_520px_at_88%_30%,#0f766e_0%,#0a3733_55%,#072927_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-12 sm:px-6 sm:pb-32 sm:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-teal-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                PMDC-verified family doctors
              </span>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-[66px]">
                Healthcare that fits <span className="text-[#ffb454]">your day.</span>
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-teal-50/90 sm:text-lg">
                See a real family doctor from home. Choose a time that suits you and meet by video, audio or text.
              </p>

              <div className="mt-7 text-xs font-bold uppercase tracking-[0.08em] text-teal-200">You can meet by</div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {[
                  { t: "Video", d: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></> },
                  { t: "Audio", d: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /> },
                  { t: "Text", d: <path d="M4 5h16v11H9l-5 4z" /> },
                ].map((m, i) => (
                  <span
                    key={m.t}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold ${
                      i === 0 ? "bg-white text-[#0a3733] shadow-lg shadow-black/25" : "border border-white/25 bg-white/10 text-white"
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={i === 0 ? "#0f766e" : "#99f6e4"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {m.d}
                    </svg>
                    {m.t}
                  </span>
                ))}
              </div>

              <div className="mt-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <Link
                  href="/book"
                  className="rounded-full bg-[#ffb454] px-8 py-4 text-center text-base font-extrabold text-[#3b2500] shadow-[0_14px_34px_rgba(255,180,84,0.3)] transition hover:bg-[#ffc272]"
                >
                  Talk to a doctor today
                </Link>
                <Link href="/#app" className="inline-flex items-center gap-2 text-sm font-bold text-teal-100 transition hover:text-white">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#99f6e4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="7" y="2" width="10" height="20" rx="2.5" />
                    <path d="M11 18h2" />
                  </svg>
                  Get the free app
                </Link>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroDoctorSpotlight />
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip — overlaps the hero */}
      <section className="relative z-10 mx-auto -mt-12 max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-5 rounded-[30px] bg-white p-6 shadow-[0_24px_50px_rgba(10,55,51,0.12)] sm:p-8 lg:grid-cols-4">
          {trustStrip.map((t) => (
            <div key={t.title} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">{t.icon}</span>
              <div>
                <p className="text-sm font-extrabold text-ink-900">{t.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SponsoredAdSlot />

      {/* Who's logging in? — two clearly separate front doors */}
      <section id="login" className="mx-auto max-w-6xl scroll-mt-32 px-4 pb-4 pt-16 sm:px-6 sm:pt-20">
        <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-700">Log in or sign up</span>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-[40px]">Who&rsquo;s logging in?</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2 md:gap-6">
          <div className="rounded-[32px] border border-[#d6efe8] bg-white p-7 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-9">
            <div className="flex items-center gap-4">
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
              </span>
              <div>
                <div className="text-[22px] font-extrabold text-ink-900">I&rsquo;m a patient</div>
                <div className="text-sm text-ink-500">Book care for yourself or your family</div>
              </div>
            </div>
            <ul className="mt-5 space-y-2.5 text-[14.5px] text-ink-700">
              {["Book, join and review your consultations", "Get prescriptions and documents in one place", "Add children and parents to one account"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="font-extrabold text-emerald-600">✓</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="flex-1 rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-3.5 text-center text-sm font-extrabold text-white shadow-lg shadow-teal-900/20 transition hover:from-teal-700 hover:to-teal-800">
                Patient login
              </Link>
              <Link href="/register" className="flex-1 rounded-full border-2 border-teal-700 px-5 py-3 text-center text-sm font-extrabold text-teal-700 transition hover:bg-teal-50">
                Create account
              </Link>
            </div>
          </div>

          <div className="rounded-[32px] bg-gradient-to-br from-[#0f766e] to-[#0a3733] p-7 text-white shadow-[0_10px_30px_rgba(10,55,51,0.25)] sm:p-9">
            <div className="flex items-center gap-4">
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-white/15">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2" />
                  <circle cx="20" cy="11" r="2" />
                </svg>
              </span>
              <div>
                <div className="text-[22px] font-extrabold">I&rsquo;m a doctor</div>
                <div className="text-sm text-teal-200">Run your practice from one place</div>
              </div>
            </div>
            <ul className="mt-5 space-y-2.5 text-[14.5px] text-teal-50/90">
              {["Your queue, availability and profile", "Earnings and payout requests", "New to Family Medic? Apply to join"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="font-extrabold text-teal-300">✓</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/doctor/login" className="flex-1 rounded-full bg-[#ffb454] px-5 py-3.5 text-center text-sm font-extrabold text-[#3b2500] transition hover:bg-[#ffc272]">
                Doctor login
              </Link>
              <Link href="/doctor/register" className="flex-1 rounded-full border-2 border-white/50 px-5 py-3 text-center text-sm font-extrabold text-white transition hover:bg-white/10">
                Join as a doctor
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-6 pt-16 sm:px-6 sm:pt-20">
        <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-700">Simple and clear</span>
        <h2 className="mt-2 max-w-xl text-3xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-[42px]">
          From booking to a plan, in three steps.
        </h2>
        <div className="mt-9 grid gap-5 sm:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className={`rounded-[28px] p-7 shadow-[0_10px_30px_rgba(10,55,51,0.06)] sm:p-8 ${s.dark ? "bg-[#0a3733] text-white" : "bg-white"}`}
            >
              <div className={`text-6xl font-extrabold leading-none ${s.numClass}`}>{s.n}</div>
              <h3 className={`mt-4 text-xl font-extrabold ${s.dark ? "text-white" : "text-ink-900"}`}>{s.title}</h3>
              <p className={`mt-2.5 text-[15px] leading-relaxed ${s.dark ? "text-teal-50/85" : "text-ink-700"}`}>{s.body}</p>
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
          no external player/library needed for one short local clip. */}
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_10px_30px_rgba(10,55,51,0.07)]">
          <div className="border-b border-ink-border px-6 py-5 text-center">
            <h3 className="text-base font-extrabold text-ink-900">
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

      {/* Families */}
      <section id="families" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid items-center gap-10 rounded-[36px] bg-gradient-to-br from-[#0d9488] to-[#0a3733] p-8 text-white sm:p-12 lg:grid-cols-2">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-200">Care for the whole family</span>
            <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-[40px]">One account. Everyone you care for.</h2>
            <p className="mt-4 text-base leading-relaxed text-teal-50/90">
              Add children and parents to your account and book for any of them in a few taps.
            </p>
            <Link href="/register" className="mt-6 inline-block rounded-full bg-[#ffb454] px-7 py-3.5 text-sm font-extrabold text-[#3b2500] transition hover:bg-[#ffc272]">
              Create your family account
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {[
              { i: "You", n: "You", r: "Self", c: "bg-teal-700 text-white" },
              { i: "Ch", n: "Your child", r: "Child", c: "bg-teal-500 text-white" },
              { i: "Pa", n: "Your parent", r: "Parent", c: "bg-[#ffb454] text-[#3b2500]" },
            ].map((m) => (
              <div key={m.i} className="flex items-center gap-3.5 rounded-[20px] bg-white p-4 text-ink-900">
                <span className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-extrabold ${m.c}`}>{m.i}</span>
                <div className="flex-1">
                  <div className="font-bold">{m.n}</div>
                  <div className="text-[13px] text-ink-500">{m.r}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Visit types */}
      <section className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
        <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-700">Your choice</span>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-[40px]">However you feel most comfortable.</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {visitTypes.map((v) => (
            <div
              key={v.t}
              className={`rounded-[28px] p-7 ${v.featured ? "bg-gradient-to-br from-[#0d9488] to-[#0a3733] text-white" : "bg-white shadow-[0_10px_30px_rgba(10,55,51,0.06)]"}`}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={v.featured ? "#fff" : "#0f766e"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {v.icon}
              </svg>
              <div className="mt-10 text-[22px] font-extrabold">{v.t}</div>
              <p className={`mt-2 text-[15px] leading-relaxed ${v.featured ? "text-teal-50/90" : "text-ink-700"}`}>{v.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Free app (install) */}
      <AppInstallSection />

      {/* Why families trust us — describes the platform itself, so
          nothing here needs swapping as the team grows (2026-09-24). */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
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
              className="inline-block rounded-full bg-white px-6 py-3 text-sm font-extrabold text-brand-950 shadow-sm transition hover:bg-teal-50"
            >
              View all our doctors →
            </Link>
          </div>
        </div>
      </section>

      {/* Common complaints */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Common reasons patients visit us
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-500">
            Pick the closest reason when you book &mdash; or something else. Your doctor takes it from there.
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
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
          Doctor-led, always
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-500 sm:text-base">
          Your doctor takes your history directly during the consultation and reviews everything personally —
          they diagnose, prescribe, and decide, always.
        </p>
      </section>

      <FeaturedReviews />

      {/* CTA banner */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[36px] bg-[#0a3733] bg-[radial-gradient(600px_300px_at_80%_0%,#0f766e_0%,transparent_70%)] px-6 py-14 text-center text-white sm:px-10 sm:py-16">
          <h3 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-[44px]">
            Ready to talk to a doctor today?
          </h3>
          <p className="mx-auto mt-4 max-w-lg text-base text-teal-50/85">
            Pick a time that suits you. Every clinical decision stays your doctor&rsquo;s.
          </p>
          <Link
            href="/book"
            className="mt-7 inline-block rounded-full bg-[#ffb454] px-9 py-4 text-base font-extrabold text-[#3b2500] transition hover:bg-[#ffc272]"
          >
            Book a Consultation
          </Link>
        </div>
      </section>
    </div>
  );
}
