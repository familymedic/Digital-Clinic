import PageHeader from "@/components/PageHeader";

export default function Contact() {
  return (
    <div>
      <PageHeader
        title="Contact"
        subtitle="A contact form will be added in a future phase. For now, this page is a placeholder."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Contact form — coming in a future phase.
        </div>
      </div>
    </div>
  );
}
