// Lag / failure reporting from the browser (site-health batch, 2026-10-07).
//
// Why this exists: doctors were hitting a page that sat on "Submitting…"
// forever and the physician was never told. Everything the browser can
// observe about a slow or failed request is sent (best effort, never
// throwing, never blocking the user) to /api/telemetry, which stores it in
// `client_events` and alerts an admin when the same problem repeats.
//
// PRIVACY: only technical facts leave the browser — an endpoint LABEL
// (path with ids stripped, no query string, no request/response bodies),
// the page path with ids stripped, how long it took, a short error
// message, connection type and browser string. Never a name, email, health
// information, token, or anything a person typed.

export type ClientEventKind = "slow" | "fail" | "timeout" | "js_error";

export interface ClientEventInput {
  kind: ClientEventKind;
  label: string;
  message?: string;
  durationMs?: number;
}

const ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{4,}\b/gi;

export function stripIds(path: string): string {
  return path.replace(ID_RE, ":id").slice(0, 120);
}

const lastSent = new Map<string, number>();
let sentThisPageLoad = 0;
const MAX_PER_PAGE_LOAD = 8;
const DEDUPE_MS = 60_000;

export function reportClientEvent(ev: ClientEventInput): void {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const key = `${ev.kind}:${ev.label}`;
    const now = Date.now();
    const last = lastSent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    if (sentThisPageLoad >= MAX_PER_PAGE_LOAD) return;
    lastSent.set(key, now);
    sentThisPageLoad += 1;

    const conn = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;

    const body = JSON.stringify({
      kind: ev.kind,
      label: ev.label.slice(0, 120),
      message: (ev.message ?? "").slice(0, 200),
      durationMs: ev.durationMs != null ? Math.round(ev.durationMs) : null,
      page: stripIds(window.location.pathname),
      effectiveType: conn?.effectiveType ?? null,
      saveData: !!conn?.saveData,
      online: navigator.onLine,
      ua: navigator.userAgent.slice(0, 200),
    });

    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/telemetry", blob)) {
      return;
    }
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never be able to break the page.
  }
}
