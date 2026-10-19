// Where to send a patient after log in / sign up when they came from the
// booking page ("?next=/book?doctorId=..."). Only same-site /book paths are
// honoured; anything else falls back to the dashboard, so this can never be
// used as an open redirect.
export function bookingReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return null;
  if (next === "/book" || next.startsWith("/book?")) {
    if (next.includes("//") || next.includes("\\") || /[\r\n]/.test(next)) return null;
    return next;
  }
  return null;
}
