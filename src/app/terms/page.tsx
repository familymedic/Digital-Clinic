import PageHeader from "@/components/PageHeader";

export default function Terms() {
  return (
    <div>
      <PageHeader
        title="Terms of Service"
        subtitle="Draft placeholder — the real terms will be written and legally reviewed before any real patient uses the platform."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm leading-relaxed text-slate-500">
          This page will describe the terms of using the platform,
          including that AI-assisted history-taking is not a substitute
          for emergency care, and that all clinical decisions are made by a
          licensed physician. Requires legal review before real-patient
          launch.
        </div>
      </div>
    </div>
  );
}
