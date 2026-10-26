import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSafepayCheckout, readSafepayConfig } from "@/lib/safepay";

// Starts a Safepay checkout for a family pack. Same pattern as the doctor
// access checkout: the caller's own token says who they are; every rule (is
// the pack on sale, is the doctor live, has the family already got one, who
// brought them, what is the price) is decided inside the database function
// package_begin_purchase, never in the browser; the purchase row is written
// with the service-role key so nobody else can create one.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Please log in to buy a pack." }, { status: 401 });

  let packageId = "";
  try {
    const body = (await request.json()) as { packageId?: unknown };
    packageId = typeof body.packageId === "string" ? body.packageId : "";
  } catch {
    /* handled below */
  }
  if (!/^[0-9a-f-]{36}$/i.test(packageId)) {
    return NextResponse.json({ error: "That pack wasn't found." }, { status: 400 });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid - please log in again." }, { status: 401 });
  }

  const { config, missing } = readSafepayConfig();
  if (!config) {
    if (missing.length) console.error("Safepay isn't configured. Missing:", missing.join(", "));
    return NextResponse.json({ error: "Online payment isn't available right now - please contact the clinic." }, { status: 503 });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: begin, error: beginError } = await serviceClient.rpc("package_begin_purchase", {
    p_account: user.id,
    p_package: packageId,
    p_environment: config.environment,
  });
  if (beginError) {
    console.error("Pack checkout: package_begin_purchase failed", beginError);
    return NextResponse.json({ error: "Couldn't start the purchase. Nothing was charged - please try again." }, { status: 500 });
  }
  const b = (begin ?? {}) as { ok?: boolean; error?: string; purchase_id?: string; amount_pkr?: number };
  if (!b.ok || !b.purchase_id || !b.amount_pkr) {
    return NextResponse.json({ error: b.error ?? "This pack isn't available right now." }, { status: 409 });
  }

  const origin = request.nextUrl.origin;
  let checkout;
  try {
    checkout = await createSafepayCheckout(config, {
      amountPkr: b.amount_pkr,
      orderId: b.purchase_id,
      // Safepay adds ?tracker=... itself, so no query string of ours here.
      redirectUrl: `${origin}/pack-return`,
      cancelUrl: `${origin}/pack-return?outcome=cancelled`,
    });
  } catch (err) {
    console.error("Pack checkout: Safepay refused", err);
    await serviceClient.rpc("package_cancel_pending", { p_purchase: b.purchase_id });
    return NextResponse.json({ error: "Couldn't start the payment. Please try again in a minute." }, { status: 502 });
  }

  const { error: trackerError } = await serviceClient.rpc("package_set_tracker", {
    p_purchase: b.purchase_id,
    p_tracker: checkout.tracker,
  });
  if (trackerError) {
    console.error("Pack checkout: couldn't save the tracker", trackerError);
    await serviceClient.rpc("package_cancel_pending", { p_purchase: b.purchase_id });
    return NextResponse.json({ error: "Couldn't save the payment record. Nothing was charged - please try again." }, { status: 500 });
  }

  return NextResponse.json({ checkoutUrl: checkout.checkoutUrl });
}
