import PageHeader from "@/components/PageHeader";

export default function Book() {
  return (
    <div>
      <PageHeader title="Book a consultation" />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Booking, payment, and guided history will be built in later
          phases (Phases 2–10). This page is a placeholder so the site
          navigates correctly today.
        </div>
      </div>
    </div>
  );
}
