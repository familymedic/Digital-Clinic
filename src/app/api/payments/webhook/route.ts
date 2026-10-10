import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSafepayTracker,
  readSafepayConfig,
  toMinorUnits,
  verifySafepayWebhookSignature,
} from "@/lib/safepay";
import { settleSucceededPayment } from "@/lib/paymentSettlement";

// Safepay V2 webhook. Safepay calls this route server-to-server when a
// payment succeeds or fails (events payment.succeeded / payment.failed,
// webhook version 2.0.0), and for the doctor-subscription events
// (subscription.*, handled further down exactly as before).
//
// V2 event envelope (from Safepay's webhook docs):
//   { token, version, merchant_api_key, type, endpoint,
//     data: { tracker, intent, state, amount, currency, metadata:{order_id}, ... },
//     created_at }
//
// A payment is only ever settled when it is genuine, by either of two
// independent proofs:
//   (a) the X-SFPY-SIGNATURE header verifies against our webhook secret, or
//   (b) Safepay's own API (called with our secret key) says the tracker
//       has ended successfully.
// Either way the payment must be one of our own pending payments and the
// amount must match. Anything else is logged (payment_webhook_issues) and
// acknowledged with 200 so Safepay doesn't retry forever.
//
// A failed attempt is NOT final in V2: the patient can retry on the same
// payment, and Safepay may send several payment.failed events for one
// tracker before a payment.succeeded. So payment.failed only records the
// attempt; it never closes the payment.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAFEPAY_WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET;

interface PaymentRow {
  id: string;
  consultation_id: string;
  account_id: string;
  status: string;
  amount: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// Subscription event shape, per Safepay's own documented webhook
// examples (safepay-docs.netlify.app/developers/webhooks/webhook-types,
// checked 2026-09-14): `data.id` (sub_...), `data.customer_email`,
// `data.status`, `data.current_period_end_date`. No merchant-supplied
// identifier is present on any subscription event per those examples —
// see the module comment above for why this matters.
interface SubscriptionEventData {
  id?: string;
  customer_email?: string;
  status?: string;
  current_period_end_date?: string;
}

async function handleSubscriptionEvent(
  serviceClient: SupabaseClient,
  eventType: string,
  body: Record<string, unknown>
) {
  const data = (body.data ?? {}) as SubscriptionEventData;
  const subscriptionId = typeof data.id === "string" ? data.id : null;
  const customerEmail = typeof data.customer_email === "string" ? data.customer_email.toLowerCase() : null;

  // 1. Try to find the doctor this event is about. A subscription we've
  //    already matched once (this same safepay_subscription_id) is
  //    matched again the same way on every later event (renewals,
  //    cancellations) — first-sight matching is by email only, and only
  //    onto a doctor who hasn't already been linked to a DIFFERENT
  //    subscription, so a stray/duplicate event can never silently
  //    reassign someone else's doctor row.
  let doctorId: string | null = null;
  if (subscriptionId) {
    const { data: bySub } = await serviceClient
      .from("doctor_profiles")
      .select("id")
      .eq("safepay_subscription_id", subscriptionId)
      .maybeSingle();
    if (bySub) doctorId = bySub.id as string;
  }
  if (!doctorId && customerEmail) {
    const { data: byEmail } = await serviceClient
      .from("doctor_profiles")
      .select("id")
      .eq("email", customerEmail)
      .is("safepay_subscription_id", null)
      .maybeSingle();
    if (byEmail) doctorId = byEmail.id as string;
  }

  // 2. Always log the event, matched or not — this is the admin-side
  //    manual-reconciliation fallback (0030) for when email matching
  //    can't find anyone (wrong/typo'd email at Safepay checkout, a
  //    doctor who hasn't registered on the app yet, etc.).
  await serviceClient.from("doctor_subscription_events").insert({
    doctor_id: doctorId,
    event_type: eventType,
    safepay_subscription_id: subscriptionId,
    customer_email: customerEmail,
    matched: doctorId !== null,
    raw_payload: body,
  });

  if (!doctorId) {
    console.error("Safepay subscription webhook: no doctor matched", { eventType, subscriptionId, customerEmail });
    return;
  }

  // 3. Update the matched doctor's own status. Deliberately NOT wired
  //    into any access-control check anywhere (Section 38 — the
  //    physician chose to hold off on enforcement until a real renewal
  //    has been confirmed firing on its own); this only ever changes
  //    what the doctor/admin SEE, never what a doctor is allowed to do.
  const now = new Date().toISOString();
  if (eventType === "subscription.created" || eventType === "subscription.payment.succeeded") {
    await serviceClient
      .from("doctor_profiles")
      .update({
        safepay_subscription_id: subscriptionId,
        subscription_status: "active",
        subscription_current_period_end: data.current_period_end_date ?? null,
        subscription_started_at: eventType === "subscription.created" ? now : undefined,
        subscription_last_event_at: now,
      })
      .eq("id", doctorId);
  } else if (eventType === "subscription.payment.failed") {
    await serviceClient
      .from("doctor_profiles")
      .update({ subscription_status: "past_due", subscription_last_event_at: now })
      .eq("id", doctorId);
  } else if (eventType === "subscription.canceled" || eventType === "subscription.ended") {
    await serviceClient
      .from("doctor_profiles")
      .update({ subscription_status: "canceled", subscription_last_event_at: now })
      .eq("id", doctorId);
  } else {
    // subscription.paused / subscription.resumed / anything else not
    // explicitly handled above — don't guess at a status change, just
    // record that something happened (the raw event is already logged).
    await serviceClient
      .from("doctor_profiles")
      .update({ subscription_last_event_at: now })
      .eq("id", doctorId);
  }
}

// Diagnostic-only log for the two cases this route already can't fully
// resolve on its own (2026-09-16 audit follow-up, fix #2) — previously
// only a console.error, so a real Safepay payload that doesn't match
// the guessed field names above left no admin-visible trace at all.
// Never affects how a payment is matched or marked — see
// 0038_payment_webhook_issues.sql.
async function logWebhookIssue(
  serviceClient: SupabaseClient,
  reason: string,
  rawPayload: Record<string, unknown>,
  paymentId?: string
) {
  try {
    await serviceClient.from("payment_webhook_issues").insert({
      payment_id: paymentId ?? null,
      reason,
      raw_payload: rawPayload,
    });
  } catch (err) {
    console.error("logWebhookIssue failed:", err);
  }
}


export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Nothing useful to do without the service-role key — but still
    // acknowledge receipt so Safepay doesn't treat this as a delivery
    // failure and retry indefinitely once it IS configured.
    return NextResponse.json({ received: true, note: "not configured" }, { status: 200 });
  }

  const rawBody = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const eventType = typeof body.type === "string" ? body.type : "";
  const data = asRecord(body.data);

  const signatureValid = SAFEPAY_WEBHOOK_SECRET
    ? verifySafepayWebhookSignature(SAFEPAY_WEBHOOK_SECRET, rawBody, request.headers.get("x-sfpy-signature"))
    : false;

  // ---- Doctor subscription events: signature is mandatory (there is no
  // payment row to cross-check them against). -------------------------
  if (eventType.startsWith("subscription.")) {
    if (!SAFEPAY_WEBHOOK_SECRET) {
      console.error("Safepay subscription webhook received but SAFEPAY_WEBHOOK_SECRET isn't configured — ignoring.");
      return NextResponse.json({ received: true, note: "webhook secret not configured" }, { status: 200 });
    }
    if (!signatureValid) {
      console.error("Safepay subscription webhook: signature verification failed", { body });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    await handleSubscriptionEvent(serviceClient, eventType, body);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ---- One-time consultation payments (V2). --------------------------
  // Old V1-shaped deliveries (data.notification...) are no longer
  // expected; if one shows up it is logged for review, never guessed at.
  const tracker = typeof data.tracker === "string" ? data.tracker : null;
  const metadata = asRecord(data.metadata);
  const orderId = typeof metadata.order_id === "string" && metadata.order_id ? metadata.order_id : null;

  const isPaymentEvent = eventType.startsWith("payment.") || eventType.startsWith("authorization.") || eventType.startsWith("void.");
  if (!isPaymentEvent || (!tracker && !orderId)) {
    await logWebhookIssue(serviceClient, `unrecognized event: ${eventType || "no type"}`, body);
    return NextResponse.json({ received: true, note: "unrecognized event" }, { status: 200 });
  }

  // Find our payment row: by the tracker we stored, else by our own id.
  let payment: PaymentRow | null = null;
  if (tracker) {
    const { data: byTracker } = await serviceClient
      .from("payments")
      .select("id, consultation_id, account_id, status, amount")
      .eq("gateway_tracker_token", tracker)
      .limit(1)
      .maybeSingle();
    if (byTracker) payment = byTracker as PaymentRow;
  }
  if (!payment && orderId) {
    const { data: byId } = await serviceClient
      .from("payments")
      .select("id, consultation_id, account_id, status, amount")
      .eq("id", orderId)
      .limit(1)
      .maybeSingle();
    if (byId) payment = byId as PaymentRow;
  }
  if (!payment) {
    console.error("Safepay webhook: no matching payment row found", { tracker, orderId });
    await logWebhookIssue(serviceClient, "no matching payment", body);
    return NextResponse.json({ received: true, note: "no matching payment" }, { status: 200 });
  }

  if (eventType === "payment.succeeded") {
    if (payment.status === "succeeded") {
      return NextResponse.json({ received: true, note: "already processed" }, { status: 200 });
    }

    // Amount check. Safepay's page doesn't say whether the webhook amount
    // is in rupees or in minor units, so both are accepted — anything
    // else is a mismatch.
    const notified = typeof data.amount === "number" ? data.amount : typeof data.amount === "string" ? Number(data.amount) : null;
    if (notified !== null && Number.isFinite(notified)) {
      const okAmounts = [payment.amount, toMinorUnits(payment.amount)];
      if (!okAmounts.includes(Math.round(notified))) {
        console.error("Safepay webhook: notified amount doesn't match the payment record", {
          paymentId: payment.id,
          expected: payment.amount,
          notified,
        });
        await logWebhookIssue(serviceClient, "amount mismatch", body, payment.id);
        return NextResponse.json({ received: true, note: "amount mismatch" }, { status: 200 });
      }
    }

    // Authenticity: a valid signature, or Safepay's own API agreeing.
    let genuine = signatureValid;
    if (!genuine && tracker) {
      const { config } = readSafepayConfig();
      if (config) {
        try {
          const info = await fetchSafepayTracker(config, tracker);
          genuine = info.paid && (!info.orderId || info.orderId === payment.id);
        } catch (err) {
          console.error("Safepay webhook: couldn't double-check the payment with Safepay", err);
        }
      }
    }
    if (!genuine) {
      console.error("Safepay webhook: payment.succeeded couldn't be verified", { tracker, orderId });
      await logWebhookIssue(serviceClient, "signature not verified and payment not confirmed with Safepay", body, payment.id);
      return NextResponse.json({ received: true, note: "unverified" }, { status: 200 });
    }

    await settleSucceededPayment(serviceClient, payment, body);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (eventType === "payment.failed") {
    // Recorded for the admin, but the payment stays open: the patient may
    // retry and succeed on the same tracker. (Only touches a still-pending row.)
    if (payment.status === "pending") {
      await serviceClient
        .from("payments")
        .update({ raw_webhook_payload: body, updated_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("status", "pending");
    }
    return NextResponse.json({ received: true, note: "failure recorded" }, { status: 200 });
  }

  // payment.refunded, authorization.*, void.* … acknowledged. Refunds are
  // still recorded by the admin at /admin/refunds.
  return NextResponse.json({ received: true, note: `acknowledged ${eventType}` }, { status: 200 });
}
