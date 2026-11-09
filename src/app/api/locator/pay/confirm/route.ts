import { NextRequest, NextResponse } from "next/server";
import { fetchSafepayTracker, readSafepayConfig, toMinorUnits } from "@/lib/safepay";
import { locatorClientIp, locatorServiceClient, makeLimiter } from "@/lib/locatorServer";

// When the owner comes back from Safepay, ask Safepay directly whether the tracker ended
// successfully (the webhook may arrive later or not at all) and settle the listing if so.
// Idempotent: settling twice does nothing.

export const maxDuration = 20;

const limited = makeLimiter(40, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
  try {
    if (limited(locatorClientIp(request))) return reply({ ok: false, error: "slow_down" }, 429);
    const text = await request.text();
    if (text.length > 512) return reply({ ok: false, error: "bad_request" }, 400);
    const b = JSON.parse(text) as Record<string, unknown>;
    const tracker = typeof b.tracker === "string" ? b.tracker.slice(0, 200) : "";
    if (!tracker) return reply({ ok: false, error: "bad_request" }, 400);
    const service = locatorServiceClient();
    if (!service) return reply({ ok: false, error: "unavailable" }, 503);

    const { data: row } = await service
      .from("locator_payments")
      .select("id, status, amount, place_id, locator_places(name)")
      .eq("gateway_tracker_token", tracker)
      .maybeSingle();
    if (!row) return reply({ ok: false, error: "not_found" }, 404);
    const placeName = (row as unknown as { locator_places: { name: string } | null }).locator_places?.name ?? null;
    if (row.status === "succeeded") return reply({ ok: true, paid: true, placeName });

    const { config } = readSafepayConfig();
    if (!config) return reply({ ok: true, paid: false, pending: true, placeName });
    let info;
    try {
      info = await fetchSafepayTracker(config, tracker);
    } catch {
      return reply({ ok: true, paid: false, pending: true, placeName });
    }
    if (!info.paid) return reply({ ok: true, paid: false, pending: !/fail|cancel|expire/i.test(info.state ?? ""), placeName });
    if (info.orderId && info.orderId !== row.id) return reply({ ok: true, paid: false, pending: true, placeName });
    if (typeof info.amountMinor === "number" && info.amountMinor !== toMinorUnits(row.amount)) {
      console.error("Locator confirm: amount mismatch", { payment: row.id, got: info.amountMinor });
      return reply({ ok: true, paid: false, pending: true, placeName });
    }
    await service.rpc("locator_settle_payment", { p_payment: row.id, p_payload: { via: "confirm", state: info.state } });
    return reply({ ok: true, paid: true, placeName });
  } catch {
    return reply({ ok: false, error: "bad_request" }, 400);
  }
}
