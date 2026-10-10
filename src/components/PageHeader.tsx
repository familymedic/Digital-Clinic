// New look (2026-10): same props and same markup contract as before
// (title + optional subtitle). Now a compact dark-teal band with the
// amber accent, matching the homepage hero. Used by every inner page
// (forms, booking, doctor and admin pages), so it stays compact.
export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-b-[32px] bg-[radial-gradient(800px_320px_at_88%_-30%,rgba(45,212,191,0.28),transparent_60%),linear-gradient(180deg,#0a3733,#072927)]">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <span className="mb-4 block h-1.5 w-10 rounded-full bg-[#ffb454]" aria-hidden="true" />
        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-[34px] sm:leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-teal-100/85 sm:text-base">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
