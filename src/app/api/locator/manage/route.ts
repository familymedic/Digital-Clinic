import { NextRequest, NextResponse } from "next/server";
import { hashToken, locatorClientIp, locatorServiceClient, looksLikeToken, makeLimiter } from "@/lib/locatorServer";

// The owner's private page data: status and what is needed next (no statistics: admin only).
// POST (not GET) so the token never lands in a URL log.

export const maxDuration = 10;

const limited = makeLimiter(60, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 256) return bad("bad_request");
    const b = JSON.parse(text) as Record<string, unknown>;
    if (!looksLikeToken(b.token)) return bad("not_found", 404);
    const service = locatorServiceClient();
    if (!service) return bad("unavailable", 503);
    const { data } = await service.rpc("locator_manage_view", { p_hash: hashToken(b.token) });
    if (!data) return bad("not_found", 404);
    const res = NextResponse.json({ ok: true, place: data });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return bad("bad_request");
  }
}
