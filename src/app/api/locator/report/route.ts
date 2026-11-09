import { NextRequest, NextResponse } from "next/server";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";

// "Report a problem" on a listing. Goes to a queue the admin reviews; nothing changes on the
// public page by itself.

export const maxDuration = 10;

const limited = makeLimiter(10, 60 * 60 * 1000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["wrong_info", "closed", "not_autism_aware", "fake", "other"]);

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 1024) return bad("bad_request");
    const b = JSON.parse(text) as Record<string, unknown>;
    if (typeof b.website === "string" && b.website.trim() !== "") return NextResponse.json({ ok: true });
    if (typeof b.placeId !== "string" || !UUID.test(b.placeId)) return bad("bad_request");
    const reason = String(b.reason ?? "");
    if (!REASONS.has(reason)) return bad("bad_request");
    const service = locatorServiceClient();
    if (!service) return bad("unavailable", 503);
    const { data, error } = await service.rpc("locator_report", {
      p_place: b.placeId,
      p_reason: reason,
      p_note: String(b.note ?? "").trim().slice(0, 400) || null,
    });
    if (error || data !== true) return bad("unavailable", 503);
    await service.rpc("locator_event", { p_event: "report", p_category: "none" });
    return NextResponse.json({ ok: true });
  } catch {
    return bad("bad_request");
  }
}
