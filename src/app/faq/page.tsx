import PageHeader from "@/components/PageHeader";

const faqs = [
  {
    q: "Is this an AI doctor?",
    a: "No. Technology only helps organize your complaint and history. Your doctor reviews everything and makes every clinical decision — diagnosis, treatment, and prescriptions are never generated automatically.",
  },
  {
    q: "How do I share my symptoms?",
    a: "You can answer a short set of guided questions, or record a voice note in your own words — the choice is yours. A free-form voice note may not cover everything the guided questions would ask, so your doctor may ask a few extra questions live.",
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
    a: "PKR 500 per consultation, paid securely before your visit.",
  },
  {
    q: "Who sees my information?",
    a: "Your information is reviewed by your doctor to prepare for and conduct your consultation. Full details will be in our Privacy Policy before the platform accepts real patients.",
  },
];

export default function FAQ() {
  return (
    <div>
      <PageHeader title="Frequently asked questions" />
      <div className="mx-auto max-w-3xl divide-y divide-slate-100 px-4 py-8 sm:px-6">
        {faqs.map((f) => (
          <div key={f.q} className="py-5">
            <p className="text-sm font-semibold text-slate-900">{f.q}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
