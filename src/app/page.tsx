import Link from "next/link";

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
      <section className="bg-gradient-to-b from-teal-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-block rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">
              Digital Family Clinic
            </span>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Your family doctor, available digitally
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
              Talk to a real family physician online — by video, audio, or
              text, whichever suits you. Tell us about your symptoms and
              health concerns before your visit so your doctor can review
              them; every clinical decision remains your doctor's.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/book"
                className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 sm:w-auto"
              >
                Book Consultation — PKR 500
              </Link>
              <Link
                href="/how-it-works"
                className="w-full rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-teal-700 hover:text-teal-700 sm:w-auto"
              >
                See how it works
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">
              Booking is coming in a future update — this is a preview of
              the site.
            </p>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-slate-100 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 text-center sm:grid-cols-3 sm:px-6">
          <div>
            <p className="text-2xl font-bold text-teal-700">PKR 500</p>
            <p className="mt-1 text-xs text-slate-500">Per consultation, transparent pricing</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-teal-700">Physician-led</p>
            <p className="mt-1 text-xs text-slate-500">Every clinical decision is your doctor's</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-teal-700">Your choice</p>
            <p className="mt-1 text-xs text-slate-500">Guided questions or a voice note; video, audio, or text for your visit</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
          How it works
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-slate-200 bg-white p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">
                {s.n}
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Common complaints */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
            Common reasons patients visit us
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-600">
            We take a focused history for each type of complaint, so your
            doctor has what they need before you even meet.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {complaints.map((c) => (
              <span
                key={c}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Doctor-led, always */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Doctor-led, always
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
          Before your consultation, we ask about your symptoms and health
          history so your doctor has everything they need. Your doctor
          reviews it personally — they diagnose, prescribe, and decide,
          always.
        </p>
      </section>
    </div>
  );
}
