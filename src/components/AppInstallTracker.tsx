"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// Installed-app tracking (2026-10-04, physician request) — see 0060 for
// the full rationale and the honest limits. Two signals only:
//   - 'installed': the browser's `appinstalled` event (Chrome/Edge/
//     Android; iPhone Safari never fires it).
//   - 'app_opened': the site is running as an installed app
//     (display-mode: standalone, or iOS's navigator.standalone), logged
//     at most once per day per browser so it counts people, not page
//     loads. This is what makes iPhone users and pre-existing installs
//     visible.
// Records NO page path and nothing about what anyone does inside the
// app — only that it was installed/opened — so unlike PageViewTracker it
// is safe to run everywhere, including the signed-in areas. Fire-and-
// forget: a failed insert (ad blocker, offline, migration not yet run)
// never affects the page.

const VISITOR_ID_KEY = "fm_visitor_id"; // shared with PageViewTracker
const LAST_OPEN_KEY = "fm_app_open_day";

type Platform = "android" | "ios" | "desktop" | "other";
type EventType = "installed" | "app_opened";

function getVisitorId(): string {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function detectPlatform(): Platform {
  const ua = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS 13+ presents itself as a Mac but has a touch screen.
  if (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return "desktop";
  return "other";
}

function isRunningAsInstalledApp(): boolean {
  const standaloneDisplay = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return standaloneDisplay || iosStandalone;
}

export default function AppInstallTracker() {
  useEffect(() => {
    const client = supabase;
    if (!client) return;

    function log(eventType: EventType) {
      client!
        .from("app_install_events")
        .insert({ event_type: eventType, platform: detectPlatform(), visitor_id: getVisitorId() })
        .then(() => {
          // Fire-and-forget.
        });
    }

    if (isRunningAsInstalledApp()) {
      const today = new Date().toISOString().slice(0, 10);
      let alreadyLoggedToday = false;
      try {
        alreadyLoggedToday = window.localStorage.getItem(LAST_OPEN_KEY) === today;
        if (!alreadyLoggedToday) window.localStorage.setItem(LAST_OPEN_KEY, today);
      } catch {
        // Storage blocked: fall through and log (can over-count a little
        // in that rare case, never under-count).
      }
      if (!alreadyLoggedToday) log("app_opened");
    }

    const handleInstalled = () => log("installed");
    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  return null;
}
