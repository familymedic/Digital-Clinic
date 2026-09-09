import PageHeader from "@/components/PageHeader";

const steps = [
  {
    title: "1. Book your consultation",
    body: "Choose the reason for your visit and pay the consultation fee (PKR 350) through a secure payment provider.",
  },
  {
    title: "2. Share your history",
    body: "Answer a short, focused set of questions with our AI assistant, or record a voice note in your own words instead. This is always your choice.",
  },
  {
    title: "3. Safety screening",
    body: "Your responses are checked against physician-approved safety rules. If anything looks urgent, you're told clearly to seek immediate care rather than wait.",
  },
  {
    title: "4. Your doctor reviews everything",
    body: "Dr. Zayn reviews your history — what you said, and what the AI organized — before your consultation starts.",
  },
  {
    title: "5. Video consultation",
    body: "You have a live video visit with your doctor, who asks follow-up questions and reaches a clinical assessment.",
  },
  {
    title: "6. Prescription & follow-up",
    body: "If appropriate, your doctor issues a prescription or referral and lets you know if a follow-up is needed. The AI never issues a prescription.",
  },
];

export default function HowItWorks() {
  return (
    <div>
      <PageHeader
        title="How it works"
        subtitle="A simple, physician-led process from booking to prescription."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ol className="space-y-6">
          {steps.map((s) => (
            <li key={s.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
