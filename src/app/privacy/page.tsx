import PageHeader from "@/components/PageHeader";

export default function Privacy() {
  return (
    <div>
      <PageHeader
        title="Privacy Policy"
        subtitle="Draft placeholder — the real policy will be written and legally reviewed before any real patient data is collected."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm leading-relaxed text-slate-500">
          This page will describe what information is collected, how it is
          used, how long it is kept, and patients' rights over their data.
          It requires physician and legal/privacy review before the
          platform accepts real patients, per the project&rsquo;s
          development plan.
        </div>
      </div>
    </div>
  );
}
