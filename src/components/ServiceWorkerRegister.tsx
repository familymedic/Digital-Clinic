"use client";

import { useEffect } from "react";

// Registers the PWA service worker (public/sw.js) once, on first load,
// on every page — required for the site to be installable at all and
// for push notifications to work later. Renders nothing; this is
// plumbing, not UI. Guarded for browsers without the API (older Safari/
// WebViews) so it never throws there.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
