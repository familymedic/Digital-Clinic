import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";

// Locator: "tell me when it reaches my city". Stores a city and a phone or email.
// Public, so: small body cap, honeypot, per-IP limit, and the database only accepts it
// through a server-only function that also checks the shape of the contact.

export const maxDuration = 15;

const limited = makeLimiter(8, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    if (limited(locatorClientIp(request))) {
      return NextResponse.json({ ok: false, error: "slow_down" }, { status: 429 });
    }
    const text = await request.text();
    if (text.length > 1024) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    const b = JSON.parse(text) as Record<string, unknown>;
    if (typeof b.website === "string" && b.website.trim() !== "") return NextResponse.json({ ok: true }); // honeypot
    const city = String(b.city ?? "").trim();
    const contact = String(b.contact ?? "").trim();
    const interest = ["doctor", "autism", "both"].includes(String(b.interest)) ? String(b.interest) : "both";
    if (city.length < 2 || city.length > 60 || contact.length < 5 || contact.length > 120) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const service = locatorServiceClient();
    if (!service) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
    const { data, error } = await service.rpc("locator_waitlist_add", {
      p_city: city,
      p_contact: contact,
      p_interest: interest,
    });
    if (error) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
    if (data !== true) return NextResponse.json({ ok: false, error: "bad_contact" }, { status: 400 });
    await service.rpc("locator_event", { p_event: "waitlist", p_category: "none" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
