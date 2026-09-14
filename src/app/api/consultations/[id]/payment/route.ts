import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSafepayPayment, buildSafepayCheckoutUrl, type SafepayEnvironment } from "@/lib/safepay";
import { computePlatformFeeShare } from "@/lib/platformFee";

// Phase 10, step 1: starts (or restarts) payment for a consultation that
// is still 'pending_payment'. Same authorization pattern as the Daily.co
// room route (src/app/api/consultations/[id]/room): the caller's own
// access token is used to re-run the exact RLS-backed SELECT the rest of
// the app already relies on, so there is no separate access-control
// logic to get wrong. Only after that passes does this route switch to
// the service-role client to write the `payments` row — which has no
// INSERT policy for anyone, so this route (and the webhook route) are
// the only things that can ever create one.
//
// Phase 10, step 2 (2026-09-14): the amount charged is now the assigned
// doctor's OWN consultation_fee (0027), looked up here server-side with
// the service-role client — never read from anything the browser sends.
// The platform/doctor split is computed via the single shared
// computePlatformFeeShare() function (src/lib/platformFee.ts) and
// recorded permanently on the payments row (0029) at the moment of
// charging, so a later change to the doctor's fee or tier never
// retroactively changes what an already-charged consultation paid out.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAFEPAY_API_KEY = process.env.SAFEPAY_API_KEY;
const SAFEPAY_ENVIRONMENT = (process.env.SAFEPAY_ENVIRONMENT as SafepayEnvironment) || "sandbox";

interface ConsultationForPayment {
  id: string;
  status: string;
  patient_id: string;
  doctor_id: string | null;
}

interface DoctorForPayment {
  consultation_fee: number | null;
  fee_status: string;
  is_active: boolean;
  custom_platform_share: number | null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: consultationId } = await context.params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

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

  const { data: consultation, error: fetchError } = await userClient
    .from("consultations")
    .select("id, status, patient_id, doctor_id")
    .eq("id", consultationId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!consultation) {
    return NextResponse.json({ error: "This consultation isn't available to you." }, { status: 404 });
  }
  const row = consultation as ConsultationForPayment;

  if (row.status !== "pending_payment") {
    return NextResponse.json(
      { error: "This consultation doesn't have a payment outstanding." },
      { status: 400 }
    );
  }
  if (!SAFEPAY_API_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Online payment isn't configured yet — the clinic needs to finish setting this up." },
      { status: 503 }
    );
  }

  if (!row.doctor_id) {
    return NextResponse.json(
      { error: "No doctor is assigned to this consultation yet — please contact the clinic." },
      { status: 409 }
    );
  }

  // Service-role client: the only thing that can ever write to
  // `payments` (no INSERT policy exists for the shared authenticated
  // role — see 0024) or move a consultation out of 'pending_payment'.
  // Also used here to look up the assigned doctor's own fee — a value
  // the patient's browser never gets to supply or influence.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: doctor, error: doctorError } = await serviceClient
    .from("doctor_profiles")
    .select("consultation_fee, fee_status, is_active, custom_platform_share")
    .eq("id", row.doctor_id)
    .maybeSingle();

  if (doctorError || !doctor) {
    return NextResponse.json({ error: "Couldn't look up the assigned doctor's fee." }, { status: 500 });
  }
  const doctorRow = doctor as DoctorForPayment;

  // Defense-in-depth, not the primary gate: 0028's assign_default_doctor
  // trigger already refuses to assign a doctor who isn't
  // approved/active/fee-approved at BOOKING time. This re-checks at
  // PAYMENT time in case the doctor's status changed in between (e.g.
  // admin deactivated them after the booking but before checkout).
  if (!doctorRow.is_active || doctorRow.fee_status !== "approved" || doctorRow.consultation_fee == null) {
    return NextResponse.json(
      { error: "The assigned doctor isn't currently available for payment — please contact the clinic." },
      { status: 409 }
    );
  }

  const consultationFee = doctorRow.consultation_fee;
  const feeResult = computePlatformFeeShare(consultationFee);
  let platformShare: number;
  let doctorShare: number;
  if (feeResult.requiresApproval) {
    if (doctorRow.custom_platform_share == null) {
      return NextResponse.json(
        {
          error:
            "This doctor's platform-fee split above PKR 1,500 hasn't been finalized by admin yet — payment can't be collected until it is.",
        },
        { status: 409 }
      );
    }
    platformShare = doctorRow.custom_platform_share;
    doctorShare = consultationFee - platformShare;
  } else {
    platformShare = feeResult.platformShare;
    doctorShare = feeResult.doctorShare;
  }

  const safepayConfig = {
    environment: SAFEPAY_ENVIRONMENT,
    apiKey: SAFEPAY_API_KEY,
    webhookSecret: "", // not needed for payment creation, only for webhook verification
  };

  let tracker;
  try {
    tracker = await createSafepayPayment(safepayConfig, { amount: consultationFee, currency: "PKR" });
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't start the payment (Safepay said: ${(err as Error).message}).` },
      { status: 502 }
    );
  }

  const { data: payment, error: insertError } = await serviceClient
    .from("payments")
    .insert({
      consultation_id: row.id,
      account_id: user.id,
      amount: consultationFee,
      platform_share: platformShare,
      doctor_share: doctorShare,
      currency: "PKR",
      gateway: "safepay",
      gateway_tracker_token: tracker.token,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !payment) {
    return NextResponse.json(
      { error: `Payment record couldn't be saved: ${insertError?.message}` },
      { status: 500 }
    );
  }

  const origin = request.nextUrl.origin;
  const checkoutUrl = buildSafepayCheckoutUrl(safepayConfig, {
    token: tracker.token,
    // Our own payment row's id, not Safepay's tracker token — this is
    // the reference we'll look for first when a webhook arrives, since
    // we chose it ourselves rather than needing to guess how Safepay
    // echoes it back.
    orderId: payment.id,
    cancelUrl: `${origin}/consultation/${row.id}/payment?outcome=cancelled`,
    redirectUrl: `${origin}/consultation/${row.id}/payment?outcome=return`,
    webhooks: true,
  });

  return NextResponse.json({ checkoutUrl });
}
