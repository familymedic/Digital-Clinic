import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { verifySafepayWebhook, type SafepayEnvironment } from "@/lib/safepay";

// Phase 10, step 1: Safepay calls this route server-to-server when a
// payment succeeds or fails. This — never anything the patient's own
// browser reports after being redirected back — is the only thing that
// ever moves a consultation out of 'pending_payment'.
//
// Genuinely unconfirmed (flagged here and in src/lib/safepay.ts, not
// silently assumed): the exact shape of the webhook's `data` payload
// beyond "there is one," and the exact terminal state string(s) Safepay
// uses. This handler is written to tolerate that — it checks a few
// plausible field names, and always stores the complete raw payload
// either way — so that a real sandbox test (which needs the physician's
// own Safepay account, not something verifiable from here) is what
// confirms or tightens the exact matching, the same way Daily.co's
// video-room logic needed one real-world fix after its first live test.
//
// Doctor onboarding, step 4 (2026-09-14): the SAME endpoint now also
// handles `subscription.*` events for the PKR 5,000/month doctor
// platform fee (a separate concern from the one-time consultation
// payments above) — one registered webhook URL rather than assuming
// Safepay supports registering two. Dispatched purely on `body.type`;
// the consultation-payment logic below is completely unchanged for any
// non-subscription event. See handleSubscriptionEvent() and
// supabase/migrations/0030_doctor_subscription_billing.sql for the
// matching approach and its known limits (email-based matching, with an
// admin-side manual override — not built on the unconfirmed assumption
// that Safepay echoes back a merchant-supplied reference on this event
// type, which its own docs and SDK disagree about).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAFEPAY_WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET;
const SAFEPAY_ENVIRONMENT = (process.env.SAFEPAY_ENVIRONMENT as SafepayEnvironment) || "sandbox";

// Best-effort extraction of (a) which of our own payment rows this
// event is about, and (b) whether it succeeded or failed. Every path
// here is a plausible-but-unconfirmed guess at Safepay's real payload
// shape EXCEPT the `order_id` match, which is reliable because we chose
// that value ourselves when creating the checkout (see the payment
// route) — it doesn't depend on guessing Safepay's own field names.
function extractOrderId(body: Record<string, unknown>): string | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const candidates = [
    data.order_id,
    data.orderId,
    (data.metadata as Record<string, unknown> | undefined)?.order_id,
    body.order_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

function extractTrackerToken(body: Record<string, unknown>): string | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const candidates = [data.token, data.tracker, data.beacon];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
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

// Notification fix (2026-09-16 audit follow-up): tells the patient
// their payment succeeded or failed, instead of the previous total
// silence (the only email anywhere in this product was one internal
// safety-event alert). Reuses the SAME Resend account already required
// for that existing email — RESEND_API_KEY here is just that same key,
// copied into this app's own server environment variables alongside
// the Supabase Vault secret the database trigger uses, not a second
// account or a new cost. If it isn't set yet, this skips silently —
// same fail-open rule as every other notification in this product: a
// missing or failing email must never affect the payment/consultation
// state itself.
async function sendPaymentOutcomeEmail(
  serviceClient: SupabaseClient,
  payment: { consultation_id: string; account_id: string },
  outcome: "succeeded" | "failed"
) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;

    const { data: userRes } = await serviceClient.auth.admin.getUserById(payment.account_id);
    const email = userRes?.user?.email;
    if (!email) return;

    const { data: consultation } = await serviceClient
      .from("consultations")
      .select("complaint")
      .eq("id", payment.consultation_id)
      .maybeSingle();
    const complaint = (consultation as { complaint?: string } | null)?.complaint ?? "your consultation";

    const subject =
      outcome === "succeeded" ? "Payment received — your consultation is confirmed" : "Payment didn't go through";
    const text =
      outcome === "succeeded"
        ? `Your payment for "${complaint}" was received. Your doctor can now see it and will begin reviewing it.`
        : `Your payment for "${complaint}" didn't go through, so this consultation hasn't been booked yet. Please try again from your dashboard, or contact the clinic if this keeps happening.`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Family Medic <onboarding@resend.dev>",
        to: [email],
        subject,
        text,
      }),
    });
  } catch (err) {
    // Never let a notification failure surface as a webhook error —
    // the payment/consultation state above is already committed and
    // correct regardless of whether this email sends.
    console.error("sendPaymentOutcomeEmail failed (payment state unaffected):", err);
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

type Outcome = "succeeded" | "failed" | "unknown";

function extractOutcome(body: Record<string, unknown>): Outcome {
  // The clearest signal, if present: an explicit event type, matching
  // the pattern Safepay's PHP SDK documents (payment.succeeded /
  // payment.failed).
  const type = typeof body.type === "string" ? body.type.toLowerCase() : "";
  if (type.includes("succeed") || type.includes("success")) return "succeeded";
  if (type.includes("fail") || type.includes("decline") || type.includes("cancel")) return "failed";

  // Fallback: a generic "state" or "status" string inside `data`, which
  // is how Safepay's own Fetch Tracker endpoint reports things
  // (TRACKER_STARTED, TRACKER_ENDED, and presumably other states this
  // hasn't been tested against yet).
  const data = (body.data ?? {}) as Record<string, unknown>;
  const state = String(data.state ?? data.status ?? "").toLowerCase();
  if (/success|paid|complet|ended/.test(state)) return "succeeded";
  if (/fail|declin|cancel|error/.test(state)) return "failed";

  return "unknown";
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

  if (SAFEPAY_WEBHOOK_SECRET) {
    const valid = verifySafepayWebhook(
      { environment: SAFEPAY_ENVIRONMENT, apiKey: "", webhookSecret: SAFEPAY_WEBHOOK_SECRET },
      body,
      request.headers
    );
    if (!valid) {
      console.error("Safepay webhook: signature verification failed", { body });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else {
    // Refuse to process an unverifiable webhook rather than silently
    // trusting an unsigned request — the same "never trust it without
    // verification" principle this whole feature exists to enforce.
    console.error("Safepay webhook received but SAFEPAY_WEBHOOK_SECRET isn't configured — ignoring.");
    return NextResponse.json({ received: true, note: "webhook secret not configured" }, { status: 200 });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const eventType = typeof body.type === "string" ? body.type : "";
  if (eventType.startsWith("subscription.")) {
    await handleSubscriptionEvent(serviceClient, eventType, body);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const orderId = extractOrderId(body);
  const trackerToken = extractTrackerToken(body);
  const outcome = extractOutcome(body);

  let query = serviceClient.from("payments").select("id, consultation_id, account_id, status").limit(1);
  if (orderId) {
    query = query.eq("id", orderId);
  } else if (trackerToken) {
    query = query.eq("gateway_tracker_token", trackerToken);
  } else {
    console.error("Safepay webhook: couldn't identify which payment this is about", { body });
    await logWebhookIssue(serviceClient, "unrecognized payload", body);
    return NextResponse.json({ received: true, note: "unrecognized payload" }, { status: 200 });
  }

  const { data: payments, error: findError } = await query;
  if (findError || !payments || payments.length === 0) {
    console.error("Safepay webhook: no matching payment row found", { orderId, trackerToken, findError });
    await logWebhookIssue(serviceClient, "no matching payment", body);
    return NextResponse.json({ received: true, note: "no matching payment" }, { status: 200 });
  }
  const payment = payments[0];

  if (payment.status !== "pending") {
    // Already resolved (e.g. a retried webhook delivery) — acknowledge
    // without redoing anything.
    return NextResponse.json({ received: true, note: "already processed" }, { status: 200 });
  }

  if (outcome === "unknown") {
    // Store the raw payload for manual inspection, but don't guess —
    // leave the payment 'pending' so it can be revisited once a real
    // payload's shape is confirmed, rather than silently marking it
    // either way on a guess.
    await serviceClient
      .from("payments")
      .update({ raw_webhook_payload: body, updated_at: new Date().toISOString() })
      .eq("id", payment.id);
    console.error("Safepay webhook: received but outcome couldn't be determined", { body, paymentId: payment.id });
    await logWebhookIssue(serviceClient, "outcome undetermined", body, payment.id);
    return NextResponse.json({ received: true, note: "outcome undetermined" }, { status: 200 });
  }

  await serviceClient
    .from("payments")
    .update({ status: outcome, raw_webhook_payload: body, updated_at: new Date().toISOString() })
    .eq("id", payment.id);

  if (outcome === "succeeded") {
    await serviceClient
      .from("consultations")
      .update({ status: "submitted" })
      .eq("id", payment.consultation_id)
      .eq("status", "pending_payment");
  }

  // Fire-and-forget: the patient notification must never delay or risk
  // the webhook's own response to Safepay (which can trigger retries on
  // a slow/failed response). The payment/consultation state above is
  // already fully committed by this point either way.
  void sendPaymentOutcomeEmail(serviceClient, payment, outcome);

  return NextResponse.json({ received: true }, { status: 200 });
}
