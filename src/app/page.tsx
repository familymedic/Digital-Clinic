import Link from "next/link";

const steps = [
  {
    n: "1",
    title: "Tell us what's bothering you",
    body: "Answer a short set of questions with our AI assistant, or record a voice note in your own words — your choice.",
  },
  {
    n: "2",
    title: "Your doctor reviews it",
    body: "A licensed physician reviews your history before your consultation begins — the AI never diagnoses or prescribes on its own.",
  },
  {
    n: "3",
    title: "Have your consultation",
    body: "Talk to your doctor, get a clear assessment, and receive a physician-approved prescription or advice when appropriate.",
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
              AI-assisted &middot; Physician-led
            </span>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Real physician care, supported by smart technology
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
              Talk to a real family physician online. Our AI assistant helps
              organize your history before your visit — it never replaces
              your doctor's judgment.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/book"
                className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 sm:w-auto"
              >
                Book Consultation — PKR 350
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
            <p className="text-2xl font-bold text-teal-700">PKR 350</p>
            <p className="mt-1 text-xs text-slate-500">Per consultation, transparent pricing</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-teal-700">Physician-led</p>
            <p className="mt-1 text-xs text-slate-500">Every clinical decision is a doctor's, not the AI's</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-teal-700">Your choice</p>
            <p className="mt-1 text-xs text-slate-500">AI questions or a voice note — never forced</p>
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
            We take a focused history for each type of complaint — not a
            generic chatbot conversation.
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

      {/* AI transparency */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          What our AI assistant does — and doesn't do
        </h2>
        <div className="mt-8 grid gap-6 text-left sm:grid-cols-2">
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-6">
            <p className="text-sm font-semibold text-teal-800">It does</p>
            <ul className="mt-3 space-y-2 text-sm text-teal-900">
              <li>Ask relevant questions about your symptoms</li>
              <li>Organize your history for your doctor</li>
              <li>Flag anything that may need urgent attention</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-semibold text-slate-700">It never does</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Diagnose your condition</li>
              <li>Prescribe or recommend medicines</li>
              <li>Replace your physician's judgment</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
