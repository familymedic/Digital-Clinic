import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";

// Locator: anonymous usage counters. Nothing about the visitor is stored: only daily totals
// per event and tab, per place (shown / call / book), and per area searched. No location, no
// user. Always answers 204 so a counter problem is never visible on the page.

export const maxDuration = 10;

const limited = makeLimiter(500, 60 * 60 * 1000);
const EVENTS = new Set([
  "search", "results", "empty", "directions_tap", "call_tap", "book_tap", "gps_denied", "coming_soon",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const done = () => new NextResponse(null, { status: 204 });
  try {
    if (limited(locatorClientIp(request))) return done();
    const text = await request.text();
    if (text.length > 2048) return done();
    const b = JSON.parse(text) as Record<string, unknown>;
    const event = String(b.event ?? "");
    if (!EVENTS.has(event)) return done();
    const category = b.category === "doctor" || b.category === "pharmacy" || b.category === "therapy" || b.category === "autism" ? b.category : "none";
    const service = locatorServiceClient();
    if (!service) return done();
    await service.rpc("locator_event", { p_event: event, p_category: category });

    // Which results were on screen (counts each place once per search).
    if (event === "results" && Array.isArray(b.ids)) {
      const ids = b.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 40);
      if (ids.length) await service.rpc("locator_places_shown", { p_ids: ids });
    }
    // Where people search from (area name or "My location"), and whether it found anything.
    if ((event === "results" || event === "empty") && category !== "none") {
      const area = typeof b.area === "string" ? b.area.trim().slice(0, 80) : "";
      if (area) await service.rpc("locator_search_note", { p_area: area, p_category: category, p_found: event === "results" });
    }
    // A Call or Book tap on one place.
    if ((event === "call_tap" || event === "book_tap") && typeof b.placeId === "string" && UUID.test(b.placeId)) {
      await service.rpc("locator_place_event", { p_place: b.placeId, p_event: event === "call_tap" ? "call" : "book" });
    }
  } catch {
    // ignore
  }
  return done();
}
