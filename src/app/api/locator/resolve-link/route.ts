import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, makeLimiter } from "@/lib/locatorServer";
import { resolveMapsUrl } from "@/lib/locatorMapsServer";

// Turns a Google Maps "Share" link (maps.app.goo.gl/...) into coordinates (see locatorMapsServer.ts
// for how it stays safe). The answer is just a latitude and longitude; nothing is stored.

export const maxDuration = 20;
export const dynamic = "force-dynamic";

const limited = makeLimiter(30, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 600) return bad("bad_request");
    const b = JSON.parse(text) as { url?: unknown };
    if (typeof b.url !== "string") return bad("bad_request");
    const r = await resolveMapsUrl(b.url);
    return r.ok ? NextResponse.json(r) : bad(r.error);
  } catch {
    return bad("cannot_read");
  }
}
