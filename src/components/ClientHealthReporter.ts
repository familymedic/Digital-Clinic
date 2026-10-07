import { reportClientEvent } from "@/lib/telemetry";

// Catches JavaScript errors and un-handled promise failures anywhere on the
// page and reports them (site-health batch, 2026-10-07). An un-handled
// rejection is exactly what left the doctor sign-up button on "Submitting…".
// Installed once from PageViewTracker, which already mounts on every page.

let installed = false;

export function installClientHealthListeners(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => {
    // Ignore cross-origin "Script error." noise and resource-load errors.
    if (!e.message || e.message === "Script error.") return;
    reportClientEvent({ kind: "js_error", label: "window", message: e.message });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unhandled promise rejection";
    // Our own timeouts/aborts are already reported with a proper label.
    if (reason instanceof Error && (reason.name === "TimeoutError" || reason.name === "AbortError")) return;
    reportClientEvent({ kind: "js_error", label: "window", message });
  });
}
