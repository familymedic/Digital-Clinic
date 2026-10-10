import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchSafepayTracker, readSafepayConfig, toMinorUnits } from "@/lib/safepay";
import { settleSucceededPayment } from "@/lib/paymentSettlement";

// Safepay V2: "confirm on return". When the patient comes back from the
// Safepay checkout, the payment page calls this route. Instead of waiting
// for the webhook (which can take over a minute), we ask Safepay directly,
// with our secret key, whether the payment finished — and settle it the
// same way the webhook does. Whichever of the two arrives first wins; the
// other finds the payment already settled and does nothing.
//
// What the patient's browser sends is never trusted as proof: the answer
// comes from Safepay's own server, and the payment must be one of THIS
// patient's own pending payments for THIS consultation, for the amount we
// charged.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: consultationId } = await context.params;

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

  // Same RLS-backed check the rest of the app uses: this consultation must
  // be visible to the caller.
  const { data: consultation } = await userClient
    .from("consultations")
    .select("id, status")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consultation) {
    return NextResponse.json({ error: "This consultation isn't available to you." }, { status: 404 });
  }
  if ((consultation as { status: string }).status !== "pending_payment") {
    return NextResponse.json({ status: "paid" });
  }

  const { config } = readSafepayConfig();
  if (!config) {
    // Not configured: nothing to ask. The webhook can still settle it.
    return NextResponse.json({ status: "pending" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Only this patient's own unsettled payments for this consultation, newest first.
  const { data: payments } = await serviceClient
    .from("payments")
    .select("id, consultation_id, account_id, amount, status, gateway_tracker_token")
    .eq("consultation_id", consultationId)
    .eq("account_id", user.id)
    .eq("status", "pending")
    .not("gateway_tracker_token", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!payments || payments.length === 0) {
    return NextResponse.json({ status: "pending" });
  }

  for (const p of payments) {
    try {
      const info = await fetchSafepayTracker(config, p.gateway_tracker_token as string);
      if (!info.paid) continue;

      // Safety checks before trusting the answer.
      if (info.orderId && info.orderId !== p.id) {
        console.error("Safepay confirm: order reference doesn't match", { paymentId: p.id, orderId: info.orderId });
        continue;
      }
      if (info.amountMinor !== null && info.amountMinor !== toMinorUnits(p.amount as number)) {
        console.error("Safepay confirm: amount doesn't match the payment record", {
          paymentId: p.id,
          expectedMinor: toMinorUnits(p.amount as number),
          gotMinor: info.amountMinor,
        });
        continue;
      }

      await settleSucceededPayment(
        serviceClient,
        { id: p.id as string, consultation_id: p.consultation_id as string, account_id: p.account_id as string },
        { source: "confirm-on-return", tracker: info.raw }
      );
      return NextResponse.json({ status: "paid" });
    } catch (err) {
      console.error("Safepay confirm: lookup failed", { paymentId: p.id, err });
    }
  }

  return NextResponse.json({ status: "pending" });
}
