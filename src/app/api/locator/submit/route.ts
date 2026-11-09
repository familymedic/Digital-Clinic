import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";
import { inPilot, KINDS, type LocatorCategory } from "@/lib/locator";

// Locator: a volunteer, owner or doctor suggests a place. It is saved as "pending" and
// stays invisible until an admin approves it. Public, so: body cap, honeypot, per-IP limit,
// owner-consent tick required, Karachi box checked here and again in the database.

export const maxDuration = 15;

// Volunteers may add several places in one outing.
const limited = makeLimiter(15, 60 * 60 * 1000);

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 4096) return bad("bad_request");
    const b = JSON.parse(text) as Record<string, unknown>;
    if (typeof b.website === "string" && b.website.trim() !== "") return NextResponse.json({ ok: true }); // honeypot

    const category = String(b.category ?? "") as LocatorCategory;
    if (category !== "doctor" && category !== "autism") return bad("bad_request");
    const kind = String(b.kind ?? "");
    if (!KINDS[category].some((k) => k.value === kind)) return bad("bad_request");
    const name = clip(b.name, 120);
    const area = clip(b.area, 80);
    if (name.length < 2 || area.length < 2) return bad("missing_fields");
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad("need_location");
    if (!inPilot(lat, lng)) return bad("outside_pilot");
    if (b.consent !== true) return bad("consent_required");
    const byName = clip(b.byName, 80);
    const byPhone = clip(b.byPhone, 30);
    if (byName.length < 2 || byPhone.replace(/\D/g, "").length < 10) return bad("need_contact");

    const service = locatorServiceClient();
    if (!service) return bad("unavailable", 503);
    const { data, error } = await service.rpc("locator_submit_place", {
      p_category: category,
      p_kind: kind,
      p_name: name,
      p_area: area,
      p_address: clip(b.address, 240) || null,
      p_phone: clip(b.phone, 30) || null,
      p_notes: clip(b.notes, 400) || null,
      p_lat: lat,
      p_lng: lng,
      p_by_name: byName,
      p_by_phone: byPhone,
      p_consent: true,
    });
    if (error) {
      const m = String(error.message);
      if (m.includes("queue_full")) return bad("queue_full", 503);
      if (m.includes("outside_pilot")) return bad("outside_pilot");
      return bad("unavailable", 503);
    }
    await service.rpc("locator_event", { p_event: "suggest", p_category: category });
    // data === null means it looked like a place we already have; thank them the same way.
    return NextResponse.json({ ok: true, duplicate: data === null });
  } catch {
    return bad("bad_request");
  }
}
