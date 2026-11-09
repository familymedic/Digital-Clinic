import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { createSafepayCheckout, readSafepayConfig } from "@/lib/safepay";

// Renewal of a doctor's own clinic listing in the Locator. The first year is free for doctors
// who have paid their access fee (see migration 0097); after that the normal annual fee for a
// clinic (Admin > Locator > Fees) is paid here through Safepay. The doctor is identified by their
// own sign-in token, the clinic must be theirs, and the amount is read from the database,
// never from the browser. The return page is the same one owners use (it asks Safepay directly).

export const maxDuration = 20;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return bad("unavailable", 503);
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return bad("not_signed_in", 401);

  let placeId = "";
  try {
    const text = await request.text();
    if (text.length > 256) return bad("bad_request");
    placeId = String((JSON.parse(text) as { placeId?: unknown }).placeId ?? "");
  } catch {
    return bad("bad_request");
  }
  if (!UUID.test(placeId)) return bad("bad_request");

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u.user) return bad("not_signed_in", 401);

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await service.rpc("locator_doctor_checkout_info", { p_doctor: u.user.id, p_place: placeId });
  const info = data as { id: string; fee_pkr: number; paid_until: string | null; renewable: boolean } | null;
  if (!info) return bad("not_found", 404);
  if (!info.renewable) return bad("not_due_yet", 409);
  if (!Number.isFinite(info.fee_pkr) || info.fee_pkr < 1) return bad("not_allowed", 409);

  const { config, missing } = readSafepayConfig();
  if (!config) {
    if (missing.length) console.error("Doctor clinic renewal: Safepay isn't configured. Missing:", missing.join(", "));
    return bad("payments_unavailable", 503);
  }

  const paymentId = randomUUID();
  const origin = request.nextUrl.origin;
  let checkout;
  try {
    checkout = await createSafepayCheckout(config, {
      amountPkr: info.fee_pkr,
      orderId: paymentId,
      redirectUrl: `${origin}/locator/paid`,
      cancelUrl: `${origin}/locator/paid?outcome=cancelled`,
    });
  } catch (err) {
    console.error("Doctor clinic renewal: Safepay refused", err);
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
    console.error("Doctor clinic renewal: couldn't save payment row", error);
    return bad("unavailable", 500);
  }
  await service.rpc("locator_event", { p_event: "pay_start", p_category: "doctor" });
  return NextResponse.json({ ok: true, checkoutUrl: checkout.checkoutUrl });
}
