import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import LocatorApp from "./LocatorApp";

// Family Medic Locator (migration 0095): Karachi pilot. One page, two tabs. This server
// part holds the search-engine text; the live search is the client component.
export const metadata: Metadata = {
  title: "Find Doctors, Clinics, Therapy & Autism-Aware Places Near You in Karachi",
  description:
    "Free locator from Family Medic. Find family doctors, clinics and pharmacies, therapy and rehab centres, and autism-aware barber shops, restaurants and shops within 2, 3 or 5 km of you in Karachi. Your location is never saved.",
  alternates: { canonical: "/locator" },
};

const faqs = [
  {
    q: "Is the locator free?",
    a: "Searching is free for everyone, and so is listing an autism-aware place. Clinics, pharmacies, labs and therapy or rehab centres pay a small annual listing fee so the locator can stay free for families.",
  },
  {
    q: "Do you save my location?",
    a: "No. Your location is used for that one search and then forgotten. We only count how many searches happen each day, without any location or personal details.",
  },
  {
    q: "What does Autism-Aware Place mean?",
    a: "The team of that place has received a short orientation from volunteers of the Vulnerable Women and Children Organization (VWCO) on how to welcome autistic children, adults and their families. It is not a medical certification.",
  },
  {
    q: "How can my clinic, pharmacy or therapy centre be listed?",
    a: "Choose List your workplace, enter your details and drop a pin at your door. Clinics, labs, hospitals and therapy centres are checked by our team before they appear; pharmacies can pay and go live straight away. A barber shop, restaurant or shop that is kind to autistic families can be suggested for free.",
  },
  {
    q: "I am not in Karachi. Can I use it?",
    a: "Karachi is the pilot city. Leave your city and a mobile number or email on the page and we will tell you when it reaches you.",
  },
];

export default function LocatorPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <div className="relative overflow-hidden rounded-b-[40px] bg-[radial-gradient(900px_380px_at_90%_-20%,rgba(45,212,191,0.32),transparent_60%),radial-gradient(500px_260px_at_0%_110%,rgba(255,180,84,0.16),transparent_65%),linear-gradient(180deg,#0a3733,#072927)]">
        <div className="mx-auto max-w-4xl px-4 pb-14 pt-9 sm:px-6 sm:pb-16 sm:pt-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold tracking-[0.14em] text-teal-100">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffb454]" aria-hidden="true" />
            KARACHI PILOT
          </span>
          <h1 className="mt-5 max-w-2xl text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-[46px]">
            Find what is <span className="text-[#ffb454]">near you</span>
          </h1>
          <p className="mt-4 hidden max-w-2xl text-base leading-relaxed text-teal-100/85 sm:block sm:text-lg">
            Doctors and clinics, therapy and rehab, and places in Karachi that welcome autistic children and their
            families, within 2, 3 or 5 km of you. No sign-up. Your location is never saved.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 max-w-4xl px-4 pb-14 sm:-mt-10 sm:px-6">
        <div className="relative z-10 overflow-hidden rounded-[32px] bg-[#f7fbfa] p-4 shadow-[0_28px_60px_-34px_rgba(7,41,39,0.55)] sm:p-6">
          <Suspense fallback={<p className="p-4 text-sm text-ink-500">Loading the locator…</p>}>
            <LocatorApp />
          </Suspense>
        </div>

        <section className="mt-12" aria-labelledby="how">
          <h2 id="how" className="text-xs font-extrabold tracking-[0.18em] text-teal-700">
            HOW IT WORKS
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              ["Tap what you need", "Doctors & Clinics, Therapy & Rehab, or Autism-Aware Places."],
              ["Share your location", "Or just pick your area. We do not save it."],
              ["See what is close", "Numbered pins on a map, then tap Directions or Call."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-3xl border border-[#d7e7e2] bg-white p-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-700 text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <p className="mt-3 font-extrabold text-ink-900">{t}</p>
                <p className="mt-1 text-sm text-ink-500">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12" aria-labelledby="faq">
          <h2 id="faq" className="text-xs font-extrabold tracking-[0.18em] text-teal-700">
            QUESTIONS
          </h2>
          <div className="mt-4 divide-y divide-[#e1eee9] rounded-3xl border border-[#d7e7e2] bg-white">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-extrabold text-ink-900">{f.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="mt-10 flex flex-col items-start gap-4 rounded-[28px] bg-[#fff6e8] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <p className="text-lg font-extrabold text-ink-900">Prefer to see a doctor from home?</p>
            <p className="mt-1 text-sm text-ink-700">Talk to a PMDC-verified family doctor by video, audio or text.</p>
          </div>
          <Link
            href="/book"
            className="inline-flex flex-none items-center justify-center rounded-full bg-teal-700 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-teal-800"
          >
            Book a doctor
          </Link>
        </div>
      </div>
    </div>
  );
}
