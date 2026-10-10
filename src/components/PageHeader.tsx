// New look (2026-10): same props and same markup contract as before
// (title + optional subtitle), restyled to the new theme — a soft mint
// wash instead of flat white, bolder title, and a short amber accent.
// Used by many pages (forms, admin, doctor pages), so it deliberately
// stays light and compact rather than becoming a full dark hero.
export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="border-b border-[var(--color-ink-border)] bg-gradient-to-b from-white to-[#f1faf7]">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <span className="mb-4 block h-1.5 w-10 rounded-full bg-[#ffb454]" aria-hidden="true" />
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[32px] sm:leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-500 sm:text-base">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
