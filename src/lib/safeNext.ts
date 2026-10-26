// Where to send a patient after log in / sign up when they came from the
// booking page ("?next=/book?doctorId=...") or the free consultation week page
// ("?next=/free-week"). Only these same-site paths are honoured; anything else
// falls back to the dashboard, so this can never be used as an open redirect.
export function bookingReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return null;
  // Family packs: back to the doctor's page (optionally with the pack link code).
  const packPage = /^\/doctors\/[0-9a-f-]{36}(\?pack=[a-z0-9]{4,20})?$/i.test(next);
  if (next === "/book" || next.startsWith("/book?") || next === "/free-week" || packPage) {
    if (next.includes("//") || next.includes("\\") || /[\r\n]/.test(next)) return null;
    return next;
  }
  return null;
}
