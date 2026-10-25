import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { createSafepayCheckout, readSafepayConfig } from "@/lib/safepay";
import { DOCTOR_ACCESS_FEE_PKR, canStartAccessCheckout, type DoctorAccessProfile } from "@/lib/doctorAccess";

// Starts a PKR 2,500 Safepay checkout for the signed-in doctor's platform
// access (a one-time fee, no expiry). Same pattern as the patient payment route: the
// caller's own token identifies who they are; the amount is fixed here on
// the server and never read from the browser; the payment row is written
// with the service-role key (nobody else can write one).
//
// Who may pay is decided HERE, not just in the screen: the doctor must be
// an approved, active doctor with use_safepay_checkout switched on, and
// must not already have active access.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await serviceClient
    .from("doctor_profiles")
    .select("is_active, verification_status, subscription_status, subscription_current_period_end, use_safepay_checkout")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: "Couldn't look up your doctor account." }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "This isn't a doctor account." }, { status: 403 });
  }

  const allowed = canStartAccessCheckout(profile as DoctorAccessProfile);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason }, { status: 409 });
  }

  const { config, missing } = readSafepayConfig();
  if (!config) {
    if (missing.length) console.error("Safepay isn't configured. Missing:", missing.join(", "));
    return NextResponse.json(
      { error: "Online payment isn't available right now — please contact the clinic." },
      { status: 503 }
    );
  }

  const paymentId = randomUUID();
  const origin = request.nextUrl.origin;
  let checkout;
  try {
    checkout = await createSafepayCheckout(config, {
      amountPkr: DOCTOR_ACCESS_FEE_PKR,
      orderId: paymentId,
      // Safepay adds ?tracker=... to the return address itself, so it is
      // kept free of any query string of our own.
      redirectUrl: `${origin}/doctor/access-return`,
      cancelUrl: `${origin}/doctor/access-return?outcome=cancelled`,
    });
  } catch (err) {
    console.error("Doctor access checkout: Safepay refused", err);
    return NextResponse.json({ error: "Couldn't start the payment. Please try again in a minute." }, { status: 502 });
  }

  const { error: insertError } = await serviceClient.from("doctor_access_payments").insert({
    id: paymentId,
    doctor_id: user.id,
    amount: DOCTOR_ACCESS_FEE_PKR,
    currency: "PKR",
    gateway: "safepay",
    gateway_environment: config.environment,
    gateway_tracker_token: checkout.tracker,
    status: "pending",
  });
  if (insertError) {
    console.error("Doctor access checkout: couldn't save payment row", insertError);
    return NextResponse.json({ error: "Couldn't save the payment record. Nothing was charged — please try again." }, { status: 500 });
  }

  return NextResponse.json({ checkoutUrl: checkout.checkoutUrl });
}
