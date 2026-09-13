import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

  const orderId = extractOrderId(body);
  const trackerToken = extractTrackerToken(body);
  const outcome = extractOutcome(body);

  let query = serviceClient.from("payments").select("id, consultation_id, status").limit(1);
  if (orderId) {
    query = query.eq("id", orderId);
  } else if (trackerToken) {
    query = query.eq("gateway_tracker_token", trackerToken);
  } else {
    console.error("Safepay webhook: couldn't identify which payment this is about", { body });
    return NextResponse.json({ received: true, note: "unrecognized payload" }, { status: 200 });
  }

  const { data: payments, error: findError } = await query;
  if (findError || !payments || payments.length === 0) {
    console.error("Safepay webhook: no matching payment row found", { orderId, trackerToken, findError });
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

  return NextResponse.json({ received: true }, { status: 200 });
}
