import PageHeader from "@/components/PageHeader";

const faqs = [
  {
    q: "Is this an AI doctor?",
    a: "No. Your doctor makes every clinical decision — diagnosis, treatment, and prescriptions are never generated automatically.",
  },
  {
    q: "How do I explain my symptoms?",
    a: "When you book, pick the reason for your visit that fits best. Then tell your doctor everything in your own words during the consultation — they will ask the right follow-up questions.",
  },
  {
    q: "Can I have my consultation by phone or text instead of video?",
    a: "Yes — you can choose video, audio, or text for your consultation, whichever you're most comfortable with.",
  },
  {
    q: "What if my symptoms are an emergency?",
    a: "This platform is not an emergency service. If you think you may be having a medical emergency, do not wait for an online consultation — seek immediate emergency care or contact your local emergency service.",
  },
  {
    q: "How much does a consultation cost?",
    a: "Each doctor sets their own consultation fee. You'll see the exact amount before you confirm your booking, and pay securely before your visit.",
  },
  {
    q: "Who sees my information?",
    a: "Your information is reviewed by your doctor to prepare for and conduct your consultation. Details are in our Privacy Policy.",
  },
];

export default function FAQ() {
  return (
    <div>
      <PageHeader title="Frequently asked questions" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        {faqs.map((f) => (
          <div key={f.q} className="rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]">
            <p className="text-[15px] font-extrabold text-ink-900">{f.q}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
