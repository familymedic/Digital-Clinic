import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";

// The counted Directions link. The visitor taps "Directions", this route counts it for that
// place, then forwards them to Google Maps with the exact pin. They continue in Google Maps
// (or the Maps app). Coordinates leave the server one place at a time, only here.

export const maxDuration = 10;

const limited = makeLimiter(120, 60 * 60 * 1000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const home = new URL("/locator", request.nextUrl.origin);
  if (!UUID.test(id) || limited(locatorClientIp(request))) return NextResponse.redirect(home, 302);
  const service = locatorServiceClient();
  if (!service) return NextResponse.redirect(home, 302);
  const { data } = await service.rpc("locator_directions_target", { p_place: id });
  const t = data as { lat: number; lng: number; name: string; area: string } | null;
  if (!t || !Number.isFinite(Number(t.lat)) || !Number.isFinite(Number(t.lng))) return NextResponse.redirect(home, 302);
  await service.rpc("locator_event", { p_event: "directions_tap", p_category: "none" });
  const dest = `${Number(t.lat).toFixed(6)},${Number(t.lng).toFixed(6)}`;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
