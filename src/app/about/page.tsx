import PageHeader from "@/components/PageHeader";

export default function About() {
  return (
    <div>
      <PageHeader title="About" />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-sm leading-relaxed text-slate-600 sm:px-6 sm:text-base">
        <p>
          Family Medicine Consult was built to bring real, physician-led
          primary care online — without pretending that a chatbot can
          replace a doctor.
        </p>
        <p>
          Our AI assistant helps organize your symptoms and history before
          your consultation, so your time with the doctor is spent on
          clinical decisions, not paperwork. It does not diagnose, and it
          does not prescribe — a licensed physician reviews every case and
          makes every clinical decision.
        </p>
        <p>
          Consultations are currently provided by Dr. Zayn, a family
          physician. As the platform grows, more physicians will join under
          the same principle: technology assists, the doctor decides.
        </p>
      </div>
    </div>
  );
}
