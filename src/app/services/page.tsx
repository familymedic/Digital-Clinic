import PageHeader from "@/components/PageHeader";

const complaints = [
  "Fever",
  "Cough",
  "Sore throat",
  "Abdominal pain",
  "Diarrhea / vomiting",
  "Headache",
  "Back pain",
  "Urinary symptoms",
  "Shortness of breath",
  "Chest pain",
  "Other / not listed",
];

export default function Services() {
  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="We currently support general family-medicine consultations for the common complaints below. More will be added over time."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {complaints.map((c) => (
            <div
              key={c}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm text-slate-700"
            >
              {c}
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-slate-500">
          Not sure which category fits? Choose &ldquo;Other&rdquo; when
          booking, or describe it in your own words with a voice note — your
          doctor will still review everything personally.
        </p>
      </div>
    </div>
  );
}
