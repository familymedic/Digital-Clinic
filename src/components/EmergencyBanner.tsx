// Kept deliberately visible on every page rather than tucked into a
// sidebar or footer — this is a clinical-safety disclaimer, not
// marketing copy, and a health platform quietly hiding its emergency
// notice is a real liability/safety problem, not just a style choice.
// Restyled 2026-09-19 (physician: the previous amber banner felt
// "annoyingly visible") to be much quieter — smaller, muted gray-blue
// instead of alarm-amber, a small icon instead of a full-width colored
// block — while staying a single line every visitor still sees.
export default function EmergencyBanner() {
  return (
    <div className="border-b border-[var(--color-ink-border)] bg-[var(--background)]">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-1.5 px-4 py-1.5 text-center text-[11.5px] text-ink-500 sm:px-6">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
        <span>
          Having a medical emergency? Don&rsquo;t wait for an online consultation — seek immediate care or contact
          your local emergency service.
        </span>
      </div>
    </div>
  );
}
