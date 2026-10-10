import PageHeader from "@/components/PageHeader";

const steps = [
  {
    title: "Choose your doctor",
    body: "Browse our PMDC-verified doctors, see who is available, and see each doctor's fee up front.",
  },
  {
    title: "Pick a time and pay securely",
    body: "Choose video, audio, or text, pick a time that suits you, and pay your doctor's consultation fee through a secure payment provider.",
  },
  {
    title: "Meet your doctor",
    body: "Join from your dashboard at your appointment time. Your doctor takes your history directly, in your own words, and reaches a clinical assessment with you.",
  },
  {
    title: "Prescription & follow-up",
    body: "If appropriate, your doctor issues a prescription or referral and lets you know if a follow-up is needed. Your doctor — never the technology — makes that decision.",
  },
];

export default function HowItWorks() {
  return (
    <div>
      <PageHeader
        title="How it works"
        subtitle="A simple, physician-led process from booking to prescription."
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex gap-5 rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0a3733] text-base font-extrabold text-[#ffb454]">
                {i + 1}
              </span>
              <div>
                <p className="text-base font-extrabold text-ink-900">{s.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
