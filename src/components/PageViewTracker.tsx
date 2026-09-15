"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Site traffic tracking (2026-09-15) — see 0036 for the full rationale.
// Deliberately only logs the PUBLIC marketing/booking-entry side of the
// site: the physician asked "how are we doing as a business," which is
// a question about visits and bookings, not about what a signed-in
// patient or doctor does once they're inside their own dashboard. Every
// authenticated workspace (patient dashboard, doctor workspace, admin,
// and the consultation itself) is excluded here, in the app rather than
// the database, so this table can never become a record of clinical
// activity by accident.

const EXCLUDED_PREFIXES = ["/dashboard", "/doctor/queue", "/doctor/availability", "/doctor/profile", "/doctor/consultations", "/admin", "/consultation", "/api"];
// /doctor and /doctor/register, /doctor/login are public (onboarding/
// marketing) and intentionally NOT excluded; "/doctor" itself (the
// signed-in dashboard) is excluded specifically below since it's an
// exact match, not a prefix other doctor sub-pages share.
const EXCLUDED_EXACT = ["/doctor"];

const VISITOR_ID_KEY = "fm_visitor_id";

function getVisitorId(): string {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    // Private browsing / blocked storage — fall back to a per-page-load
    // id rather than failing; it just won't dedupe across page views.
    return crypto.randomUUID();
  }
}

export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!supabase || !pathname) return;
    if (EXCLUDED_EXACT.includes(pathname)) return;
    if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return;

    let referrerHost: string | null = null;
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : null;
    } catch {
      referrerHost = null;
    }

    supabase
      .from("site_page_views")
      .insert({ path: pathname, referrer_host: referrerHost, visitor_id: getVisitorId() })
      .then(() => {
        // Fire-and-forget — a failed insert (e.g. ad blocker, offline)
        // should never affect the page itself.
      });
  }, [pathname]);

  return null;
}
