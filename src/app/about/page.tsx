import PageHeader from "@/components/PageHeader";

export default function About() {
  return (
    <div>
      <PageHeader title="About" />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-sm leading-relaxed text-slate-600 sm:px-6 sm:text-base">
        <p>
          Family Medicine Consult was built to bring real, physician-led
          primary care online — without pretending that technology can
          replace a doctor.
        </p>
        <p>
          Our technology helps organize your complaint and history before
          your consultation, so your time with the doctor is spent on
          clinical decisions, not paperwork. Every clinical decision —
          diagnosis, treatment, and prescriptions — is made by a licensed
          physician, never by the technology.
        </p>
        <p>
          Consultations are provided by a licensed family physician, by
          video, audio, or text — whichever you prefer. As the platform
          grows, more physicians will join under the same principle:
          technology assists, the doctor decides.
        </p>
      </div>
    </div>
  );
}
