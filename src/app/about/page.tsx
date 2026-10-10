import PageHeader from "@/components/PageHeader";

export default function About() {
  return (
    <div>
      <PageHeader title="About" subtitle="Real, physician-led family medicine — online." />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 sm:px-6">
        <div className="rounded-3xl bg-white p-6 text-[15px] leading-relaxed text-ink-700 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-8 sm:text-base">
          <p>
            Family Medic is a digital family clinic, built to bring real,
            physician-led family medicine online — without pretending that
            technology can replace a doctor.
          </p>
          <p className="mt-4">
            Your doctor takes your history directly during the consultation,
            so you can explain things in your own words. Every clinical
            decision — diagnosis, treatment, and prescriptions — is made by a
            licensed physician, never by the technology.
          </p>
          <p className="mt-4">
            Consultations are provided by licensed family physicians, by
            video, audio, or text — whichever you prefer. As the platform
            grows, more physicians will join under the same principle:
            technology assists, the doctor decides.
          </p>
        </div>
      </div>
    </div>
  );
}
