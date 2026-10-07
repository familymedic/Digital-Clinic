import { reportClientEvent, stripIds } from "@/lib/telemetry";

// One place that makes every browser network call safe (site-health batch,
// 2026-10-07). Before this, a request that never finished left screens
// stuck on "Submitting…" / "Loading…" with no error and no way out:
//
//   * `timedFetch`      — fetch with a hard timeout. Never waits forever.
//   * `monitoredFetch`  — timedFetch + reports slow/failed calls. Plugged
//                         into the Supabase browser client, so EVERY
//                         database / auth / storage call from the browser
//                         now has a timeout and is watched.
//   * `apiFetch`        — for our own /api routes: never throws, returns
//                         { ok, status, data, error, uncertain } with a
//                         plain-language error the UI can show as-is.

const SLOW_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const STORAGE_TIMEOUT_MS = 120_000; // file uploads on slow mobile data

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function labelFor(url: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = new URL(url, base);
    const segments = u.pathname.split("/");
    if (typeof window !== "undefined" && u.origin !== window.location.origin) {
      // Supabase: keep only /rest/v1/<table>, /auth/v1/<x>, /storage/v1/object
      return `supabase${stripIds(segments.slice(0, 4).join("/"))}`;
    }
    return stripIds(u.pathname);
  } catch {
    return "unknown";
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = "The request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  report = true
): Promise<Response> {
  const url = urlOf(input);
  const label = labelFor(url);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  // Respect a caller-supplied abort (e.g. navigating away).
  const outer = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;

  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    const ms = elapsed();
    if (report) {
      if (ms > SLOW_MS) reportClientEvent({ kind: "slow", label, durationMs: ms });
      if (res.status >= 500 || res.status === 413) {
        reportClientEvent({ kind: "fail", label, message: `HTTP ${res.status}`, durationMs: ms });
      }
    }
    return res;
  } catch (err) {
    const ms = elapsed();
    if (timedOut) {
      if (report) reportClientEvent({ kind: "timeout", label, durationMs: ms, message: `no response in ${Math.round(timeoutMs / 1000)}s` });
      throw new RequestTimeoutError();
    }
    // Caller aborted on purpose (navigation) — not a problem worth reporting.
    if (outer?.aborted) throw err;
    // A device that is simply offline can't be helped and can't reach us to
    // report anyway — only report failures from devices that think they are online.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (report && !offline) reportClientEvent({ kind: "fail", label, durationMs: ms, message: err instanceof Error ? err.message : "network error" });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Calls that are fire-and-forget analytics: they still get a timeout, but a
// failure is never worth reporting (ad blockers and flaky networks hit them
// constantly and nobody is waiting on them).
const QUIET_LABELS = ["/rest/v1/site_page_views", "/rest/v1/client_events", "/rest/v1/push_subscriptions"];

// Used as the Supabase client's `global.fetch`.
export function monitoredFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  // Never monitor the monitor.
  if (url.includes("/api/telemetry")) return fetch(input, init);
  const timeout = /\/storage\/v1\//.test(url) ? STORAGE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const quiet = QUIET_LABELS.some((q) => url.includes(q));
  return timedFetch(input, init, timeout, !quiet);
}

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  error: string | null;
  // True when the request may have reached the server but we never saw an
  // answer (timeout / connection dropped) — the action might have worked.
  uncertain: boolean;
}

function friendlyStatusMessage(status: number): string {
  if (status === 413) return "That file is too large to upload. Please choose a smaller one (under 4MB).";
  if (status === 401) return "Your session has expired. Please log in again.";
  if (status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (status >= 500) return "The server is busy right now. Please wait a moment and try again.";
  return "Something went wrong. Please try again.";
}

export async function apiFetch<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number } = {}
): Promise<ApiResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  try {
    const res = await timedFetch(url, init, timeoutMs);
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) {
      const serverMsg = (data as { error?: unknown })?.error;
      return {
        ok: false,
        status: res.status,
        data,
        error: typeof serverMsg === "string" && serverMsg ? serverMsg : friendlyStatusMessage(res.status),
        uncertain: res.status >= 500,
      };
    }
    return { ok: true, status: res.status, data, error: null, uncertain: false };
  } catch (err) {
    const timedOut = err instanceof RequestTimeoutError;
    return {
      ok: false,
      status: 0,
      data: {} as T,
      error: timedOut
        ? "This is taking longer than expected — your connection may be slow. Please check your connection and try again."
        : "Couldn't reach the server. Please check your internet connection and try again.",
      uncertain: true,
    };
  }
}

// Drop-in for the common "fetch, then read JSON" pair used across the admin
// screens: `const { res, data } = await safeJson(url, init)`. Same shape as
// before (`res.ok`, `res.status`, `data.error`) but it can never throw or
// hang — a timeout / dropped connection comes back as !res.ok with a
// plain-language `data.error`.
export async function safeJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 45_000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ res: { ok: boolean; status: number }; data: Record<string, any> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await apiFetch<Record<string, any>>(url, init, { timeoutMs });
  return { res: { ok: r.ok, status: r.status }, data: { ...r.data, ...(r.ok ? {} : { error: r.error }) } };
}
