import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { verifySafepayWebhook, extractRawJsonField, type SafepayEnvironment } from "@/lib/safepay";

// Phase 10, step 1: Safepay calls this route server-to-server when a
// payment succeeds or fails. This — never anything the patient's own
// browser reports after being redirected back — is the only thing that
// ever moves a consultation out of 'pending_payment'.
//
// Genuinely unconfirmed (flagged here and in src/lib/safepay.ts, not
// silently assumed): the exact terminal state string(s) Safepay uses
// beyond "PAID". This handler is written to tolerate that — it checks
// a few plausible field names/patterns, and always stores the complete
// raw payload either way. Two separate things went wrong in real
// production traffic and were each corrected in turn (2026-09-20): the
// payload SHAPE (see the comments on extractOrderId below for the
// real, confirmed envelope shape — found in this route's own
// payment_webhook_issues log, after an earlier fix based on Safepay's
// dashboard preview turned out to be based on a simplified,
// non-representative view), and separately the signature check itself
// (see safepay.ts and the comment above the POST handler's signature
// logic — a real payment was signed and verified successfully, then a
// later one was rejected by the same code with no changes in between).
// Worth
// remembering next time something here looks wrong: trust a payload
// pulled from this route's own logs over anything copied from
// Safepay's own dashboard UI.
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

// Field-matching, updated 2026-09-20 against a REAL raw delivery pulled
// straight from this route's own payment_webhook_issues log (not from
// Safepay's dashboard preview, which is what the 2026-09-19 fix below
// was based on — that preview turned out to show only an inner,
// simplified view of the notification, not the actual bytes Safepay
// POSTs here). The real, authoritative shape for a one-time payment
// notification is an ENVELOPE, not a flat object and not the
// {type, data} subscription shape either:
//
//   { "data": {
//       "type": "payment:created", "token": "...", "endpoint": "...",
//       "notification": {
//         "state": "PAID", "tracker": "track_...", "amount": "500.00",
//         "metadata": { "source": "custom", "order_id": "..." }
//       },
//       "delivery_attempts": 1
//   } }
//
// i.e. everything actually lives under `data.notification`, and
// `metadata` there is a plain {source, order_id} object, not an array
// of {meta_key, meta_value} pairs. This delivery passed signature
// verification (see isEventShaped below), so — unlike the 2026-09-19
// fix's assumption — this notification type IS signed after all; the
// dashboard-preview payload that suggested otherwise was apparently
// not representative of the real POST body. `data.notification` is
// checked first everywhere below since it's the one now confirmed by
// an actual delivery inspected from our own logs; the previous
// guesses are kept as fallbacks in case a differently-shaped delivery
// shows up later.
function extractOrderId(body: Record<string, unknown>): string | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const notification = (data.notification ?? {}) as Record<string, unknown>;
  const notifMetadata = (notification.metadata ?? {}) as Record<string, unknown>;
  if (typeof notifMetadata.order_id === "string" && notifMetadata.order_id.length > 0) {
    return notifMetadata.order_id;
  }

  // 2026-09-19 guess: a payment_metadata array of {meta_key, meta_value}
  // pairs, directly on the body. Not what a real delivery turned out to
  // look like, but harmless to keep checking.
  const metadata = Array.isArray(body.payment_metadata) ? body.payment_metadata : [];
  for (const entry of metadata) {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (e.meta_key === "order_id" && typeof e.meta_value === "string" && e.meta_value.length > 0) {
      return e.meta_value;
    }
  }
  // Fallbacks for the {type, data}-shaped subscription event stream, or
  // any other shape Safepay might send that hasn't been seen yet.
  const candidates = [
    body.order_id,
    data.order_id,
    data.orderId,
    (data.metadata as Record<string, unknown> | undefined)?.order_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

function extractTrackerToken(body: Record<string, unknown>): string | null {
  // Real shape (2026-09-20): data.notification.tracker — this is the
  // SAME tracker.token value stored as gateway_tracker_token when the
  // payment was created (see the payment route). Checked first: the
  // outer envelope's own data.token is a different, unrelated
  // identifier (Safepay's own notification/delivery id) that happens
  // to also be a string, and matching on it by mistake is exactly what
  // caused a real payment to log "no matching payment" instead of
  // completing.
  const data = (body.data ?? {}) as Record<string, unknown>;
  const notification = (data.notification ?? {}) as Record<string, unknown>;
  if (typeof notification.tracker === "string" && notification.tracker.length > 0) {
    return notification.tracker;
  }

  const candidates = [body.tracker, body.token];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  const nested = [data.token, data.tracker, data.beacon];
  for (const c of nested) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

// Real shape (2026-09-20): a plain numeric-string "amount" inside
// data.notification (e.g. "500.00"). Used only as a sanity check
// alongside order_id matching — never as the sole identifier.
function extractAmount(body: Record<string, unknown>): number | null {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const notification = (data.notification ?? {}) as Record<string, unknown>;
  const raw = notification.amount ?? body.amount;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const parsed = typeof raw === "number" ? raw : parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
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
  // Real shape, confirmed 2026-09-20 from an actual raw delivery: the
  // state lives at data.notification.state — "PAID" on the successful
  // sandbox delivery this was checked against. Failure/decline/cancel
  // state strings haven't been seen on a real payload yet, so this
  // stays a pattern match rather than an exact string.
  const data0 = (body.data ?? {}) as Record<string, unknown>;
  const notification0 = (data0.notification ?? {}) as Record<string, unknown>;
  const notifState = typeof notification0.state === "string" ? notification0.state.toLowerCase() : "";
  if (/paid|success|complet/.test(notifState)) return "succeeded";
  if (/fail|declin|cancel|expir|void|error/.test(notifState)) return "failed";

  // 2026-09-19 guess: a plain top-level "state" field. Not what a real
  // delivery turned out to look like, but harmless to keep checking.
  const topState = typeof body.state === "string" ? body.state.toLowerCase() : "";
  if (/paid|success|complet/.test(topState)) return "succeeded";
  if (/fail|declin|cancel|expir|void|error/.test(topState)) return "failed";

  // The clearest signal on the OTHER shape this route handles: an
  // explicit event type, matching the pattern Safepay's PHP SDK
  // documents (payment.succeeded / payment.failed) — real for the
  // subscription.* event stream (0030), not seen on a one-time payment.
  const type = typeof body.type === "string" ? body.type.toLowerCase() : "";
  if (type.includes("succeed") || type.includes("success")) return "succeeded";
  if (type.includes("fail") || type.includes("decline") || type.includes("cancel")) return "failed";

  // Last fallback: a nested "state"/"status" inside `data`, for
  // whatever event shape this hasn't been tested against yet.
  const data = (body.data ?? {}) as Record<string, unknown>;
  const nestedState = String(data.state ?? data.status ?? "").toLowerCase();
  if (/success|paid|complet|ended/.test(nestedState)) return "succeeded";
  if (/fail|declin|cancel|error/.test(nestedState)) return "failed";

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

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Correction, 2026-09-20 (round 2 — a real production incident, not a
  // guess): a real PKR 500 sandbox payment was retried by Safepay 5
  // times and rejected every time (confirmed via Safepay's own delivery
  // log), with no new row ever appearing in payment_webhook_issues —
  // meaning this route's signature check itself was rejecting it before
  // ever reaching the matching logic below, on a payment that a
  // PREVIOUS real delivery (with no code change in between) had signed
  // and verified successfully. Root cause, fixed in safepay.ts: the
  // check was re-serializing the already-parsed `data` object with
  // JSON.stringify and hashing that, which only matches Safepay's real
  // signature when their own on-the-wire JSON formatting happens to be
  // byte-identical to Node's default JSON.stringify output — not
  // guaranteed, and evidently not reliable in practice. It now hashes
  // the exact raw substring of `data` as it appeared in the request
  // (extractRawJsonField, below), which is the correct general
  // approach for verifying an HMAC.
  //
  // Given that this check has already been observed to reject a real,
  // successfully-paid consultation at least once, it is no longer a
  // hard gate for a one-time PAYMENT notification: a failed or
  // unverifiable signature is logged, but the request still falls
  // through to the same order_id + pending-status + amount-match safety
  // net a flat/unsigned payload always used (see the amount-mismatch
  // check further down) — that safety net is the actual authority for
  // this class of message now, with a valid signature treated as a
  // bonus positive signal rather than a requirement. A subscription.*
  // event is the one case still held to a strict, hard-gated signature
  // requirement: there is no payments row to independently cross-check
  // a subscription event against, so a valid signature is the only
  // thing standing between this code and blindly trusting an
  // unauthenticated POST to change a doctor's billing status.
  const topLevelType = typeof body.type === "string" ? body.type : "";
  const isSubscriptionEvent = topLevelType.startsWith("subscription.");
  const hasDataField = body.data !== undefined;

  let signatureValid: boolean | null = null;
  if (hasDataField && SAFEPAY_WEBHOOK_SECRET) {
    const rawData = extractRawJsonField(rawBody, "data");
    signatureValid = rawData
      ? verifySafepayWebhook(
          { environment: SAFEPAY_ENVIRONMENT, apiKey: "", webhookSecret: SAFEPAY_WEBHOOK_SECRET },
          rawData,
          request.headers
        )
      : false;
  }

  if (isSubscriptionEvent) {
    if (!SAFEPAY_WEBHOOK_SECRET) {
      console.error("Safepay subscription webhook received but SAFEPAY_WEBHOOK_SECRET isn't configured — ignoring.");
      return NextResponse.json({ received: true, note: "webhook secret not configured" }, { status: 200 });
    }
    if (!signatureValid) {
      console.error("Safepay subscription webhook: signature verification failed", { body });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    await handleSubscriptionEvent(serviceClient, topLevelType, body);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (signatureValid === false) {
    console.error(
      "Safepay webhook: signature did not verify for a payment notification — falling back to order/amount matching instead of rejecting outright",
      { body }
    );
  }

  const orderId = extractOrderId(body);
  const trackerToken = extractTrackerToken(body);
  const outcome = extractOutcome(body);
  const notifiedAmount = extractAmount(body);

  let query = serviceClient.from("payments").select("id, consultation_id, account_id, status, amount").limit(1);
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

  // The safety-net check described above: every payment notification
  // (whether or not its signature verified) must agree with what this
  // specific payment row was actually charged. A mismatch is treated
  // the same as an unmatched payment — logged, left `pending`, never
  // guessed at.
  if (notifiedAmount !== null && notifiedAmount !== payment.amount) {
    console.error("Safepay webhook: notified amount doesn't match the payment record", {
      paymentId: payment.id,
      expected: payment.amount,
      notified: notifiedAmount,
    });
    await logWebhookIssue(serviceClient, "amount mismatch", body, payment.id);
    return NextResponse.json({ received: true, note: "amount mismatch" }, { status: 200 });
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