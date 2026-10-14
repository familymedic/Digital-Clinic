import { supabase } from "@/lib/supabaseClient";

// Doctor views report (2026-10-14, migration 0074). Records how people
// interact with a doctor's PUBLIC listing so the admin can see numbers per
// doctor. Strictly fire-and-forget: nothing here can ever delay, change or
// break the page it is called from. No account id, name or IP is sent — only
// the doctor, what happened, the same random browser id the traffic tracker
// already uses, and an optional source tag (e.g. "card-whatsapp" from a
// doctor's shared card link).
//
// If the database part (0074) isn't installed, the first failed write turns
// tracking off for the rest of that page session, so a missing table can't
// spam the site-health log with failures.

export type DoctorEvent = "shown" | "card_click" | "profile_view" | "book_click";

const VISITOR_ID_KEY = "fm_visitor_id"; // shared with PageViewTracker
let disabled = false;

function visitorId(): string | null {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return null; // blocked storage: skip rather than invent ids
  }
}

function looksLikeBot(): boolean {
  try {
    return /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

// Once-per-day / once-per-30-minutes de-duplication, kept in the browser.
function alreadyCounted(key: string, windowMs: number, useSession: boolean): boolean {
  try {
    const store = useSession ? window.sessionStorage : window.localStorage;
    const last = Number(store.getItem(key) ?? 0);
    if (last && Date.now() - last < windowMs) return true;
    store.setItem(key, String(Date.now()));
    return false;
  } catch {
    return false;
  }
}

async function ownDoctorId(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record one event for each doctor id. `source` is optional context
 * (profile views: the ?ref= tag; book clicks: "list" or "profile").
 * "shown" counts once per visitor per doctor per day, "profile_view" once
 * per visitor per doctor per 30 minutes; clicks are counted every time.
 */
export function trackDoctorEvents(doctorIds: string[], event: DoctorEvent, source?: string | null): void {
  if (disabled || !supabase || typeof window === "undefined" || doctorIds.length === 0) return;
  if (looksLikeBot()) return;
  const client = supabase;
  const vid = visitorId();
  if (!vid) return;

  void (async () => {
    try {
      const me = await ownDoctorId(); // a doctor looking at their own listing isn't a patient view
      const day = new Date().toISOString().slice(0, 10);
      const ids = doctorIds.filter((id) => {
        if (!id || id === me) return false;
        if (event === "shown") return !alreadyCounted(`fm_de_shown:${day}:${id}`, 24 * 3600 * 1000, false);
        if (event === "profile_view") return !alreadyCounted(`fm_de_pv:${id}`, 30 * 60 * 1000, true);
        return true;
      });
      if (ids.length === 0) return;
      const tag = source ? source.slice(0, 40) : null;
      const { error } = await client
        .from("doctor_events")
        .insert(ids.map((doctor_id) => ({ doctor_id, event, visitor_id: vid, source: tag })));
      if (error) disabled = true;
    } catch {
      disabled = true;
    }
  })();
}

export function trackDoctorEvent(doctorId: string, event: DoctorEvent, source?: string | null): void {
  trackDoctorEvents([doctorId], event, source);
}
