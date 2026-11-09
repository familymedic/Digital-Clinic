import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSafepayCheckout, readSafepayConfig } from "@/lib/safepay";
import { hashToken, locatorClientIp, locatorServiceClient, looksLikeToken, makeLimiter } from "@/lib/locatorServer";

// Starts the Safepay checkout for a workplace's annual listing fee. The owner is identified by
// their private manage token (no account). The amount is read from the database fee table,
// never from the browser. Clinics, labs, hospitals and therapy centres can pay only after an
// admin has verified their documents; pharmacies can pay straight away.

export const maxDuration = 20;

const limited = makeLimiter(10, 60 * 60 * 1000);

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
    const { data } = await service.rpc("locator_checkout_info", { p_hash: hashToken(b.token) });
    const info = data as {
      id: string; status: string; verification_status: string; requires_verification: boolean; fee_pkr: number;
    } | null;
    if (!info) return bad("not_found", 404);
    if (info.status === "hidden" || info.verification_status === "rejected") return bad("not_allowed", 409);
    if (info.requires_verification && info.verification_status !== "verified") return bad("needs_verification", 409);
    if (!Number.isFinite(info.fee_pkr) || info.fee_pkr < 1) return bad("not_allowed", 409);

    const { config, missing } = readSafepayConfig();
    if (!config) {
      if (missing.length) console.error("Locator checkout: Safepay isn't configured. Missing:", missing.join(", "));
      return bad("payments_unavailable", 503);
    }

    const paymentId = randomUUID();
    const origin = request.nextUrl.origin;
    let checkout;
    try {
      checkout = await createSafepayCheckout(config, {
        amountPkr: info.fee_pkr,
        orderId: paymentId,
        // Safepay appends ?tracker=... itself, so no query string of ours. The manage token is
        // deliberately NOT put in this address.
        redirectUrl: `${origin}/locator/paid`,
        cancelUrl: `${origin}/locator/paid?outcome=cancelled`,
      });
    } catch (err) {
      console.error("Locator checkout: Safepay refused", err);
      return bad("gateway_error", 502);
    }
    const { error } = await service.from("locator_payments").insert({
      id: paymentId,
      place_id: info.id,
      amount: info.fee_pkr,
      currency: "PKR",
      method: "safepay",
      status: "pending",
      months: 12,
      gateway_environment: config.environment,
      gateway_tracker_token: checkout.tracker,
    });
    if (error) {
      console.error("Locator checkout: couldn't save payment row", error);
      return bad("unavailable", 500);
    }
    await service.rpc("locator_event", { p_event: "pay_start", p_category: "none" });
    return NextResponse.json({ ok: true, checkoutUrl: checkout.checkoutUrl });
  } catch {
    return bad("bad_request");
  }
}
