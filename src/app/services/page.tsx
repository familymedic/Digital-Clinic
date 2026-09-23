import PageHeader from "@/components/PageHeader";

// Services page rewrite, 2026-09-23 (physician's own brief). Replaces the
// old bare complaint grid with a structured description of what the
// platform actually offers, organized around real, currently-supported
// capabilities rather than a symptom checklist. Deliberately does NOT
// claim anything the app doesn't actually do yet — no medication
// delivery/pharmacy fulfillment, no lab-test booking or scheduling, no
// standalone lab-review-only service, no dedicated chronic-disease
// tracking tools, no guaranteed free follow-ups (a doctor can offer one,
// at their own discretion, via the existing follow-up voucher feature —
// see migration 0041). "Family & Children's Health" describes general
// family medicine covering every age, not a dedicated pediatric
// specialty, since no such distinction exists in this app.
//
// The complaint examples below are deliberately written as natural
// patient-friendly phrasing ("cough or cold") rather than copied
// verbatim from `src/lib/complaints.ts` — that file's exact strings are
// matched literally against `clinical_modules.complaint` for the
// guided-history flow (see its own comment), and this page never feeds
// into that lookup, so there's no need (and no reason) to constrain its
// wording to those exact labels.
//
// Physician's explicit choices for this page (asked via clarifying
// questions before building): stacked detail cards, no per-section
// "Book now" links (booking stays reachable via the nav/footer, exactly
// as before — this page doesn't touch /book), one dedicated reassurance
// + emergency callout near the top rather than repeated inline, and
// short/scannable per-service descriptions.

const SERVICES: {
  title: string;
  description: string;
  examples?: string;
}[] = [
  {
    title: "Online Family Medicine Consultations",
    description:
      "Talk to a doctor about the kind of everyday health concern most families deal with — by text, audio, or video, whichever suits you. Your doctor personally reviews your history and complaint before every visit, and you don't need a diagnosis in mind before you book.",
    examples:
      "Fever, cough or cold, sore throat, headache, back pain, abdominal pain, diarrhea or vomiting, urinary symptoms, and other everyday complaints.",
  },
  {
    title: "Family & Children's Health",
    description:
      "Add every family member to your account — including children — and book a consultation for any of them under one login. The same doctor-led process applies at every age: your history is reviewed and a plan is worked out together.",
    examples:
      "A child's fever or cough, a parent's recurring headache, or any other family member's everyday health concern.",
  },
  {
    title: "Medication & Prescription Support",
    description:
      "When your doctor decides medication is appropriate, they'll issue a clear prescription — diagnosis, medicine, and dosage instructions — that appears directly on your dashboard as soon as it's issued, ready to show at any pharmacy.",
  },
  {
    title: "Lab / Health Report Review",
    description:
      "Already have lab results or a health report? Upload them to your dashboard's Health Records section any time, or share them during a text consultation, and your doctor will go over them as part of your visit.",
  },
  {
    title: "Follow-up Care",
    description:
      "If your doctor wants to check on how you're doing after a visit, they can invite you back for a follow-up consultation — and some follow-ups may be offered at no extra cost, at your doctor's discretion.",
  },
  {
    title: "Chronic Disease Follow-up",
    description:
      "Managing an ongoing condition? Regular consultations let your doctor check on your progress, adjust guidance, and update your prescription as needed, rather than starting from scratch every visit.",
    examples: "High blood pressure, diabetes, asthma, and similar conditions that need ongoing attention.",
  },
  {
    title: "Preventive & Family Health",
    description:
      "Beyond treating a specific complaint, your doctor can also talk through general health and lifestyle questions — diet, activity, everyday risk factors — as part of any consultation, for you or any family member.",
  },
];

export default function Services() {
  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="Family medicine care for you and your family, delivered online by a real doctor — from everyday complaints to ongoing follow-up."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-5 text-sm leading-relaxed text-teal-900">
          <p>
            You don&rsquo;t need to know exactly what&rsquo;s wrong before you book. Describe your concern in your own
            words, or record a voice note instead — your doctor will ask the right follow-up questions and work
            out what&rsquo;s going on together with you.
          </p>
          <p className="mt-3">
            If you&rsquo;re having severe chest pain, significant difficulty breathing, or any other medical
            emergency, please don&rsquo;t wait for an online consultation — seek immediate in-person care or contact
            your local emergency service.
          </p>
        </div>

        <div className="mt-8 space-y-5">
          {SERVICES.map((s) => (
            <div key={s.title} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
              <p className="text-sm font-semibold text-slate-900 sm:text-base">{s.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.description}</p>
              {s.examples && (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  <span className="font-medium text-slate-600">Examples: </span>
                  {s.examples}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
