import crypto from "crypto";

// Safepay V2 ("Express Checkout") client — replaces the old V1 code that
// used /order/v1/init and the old /checkout/pay page.
//
// How V2 works (from Safepay's own integration docs and their official
// Node SDK source, @sfpy/node-core):
//   1. Server -> POST /order/payments/v3/        opens a payment "tracker"
//   2. Server -> POST /client/passport/v1/token  gets a short-lived "tbt"
//   3. Browser is sent to the hosted checkout:   {host}/embedded/?tracker=..&tbt=..
//   4. Safepay returns the patient to our site with ?tracker=... added, and
//      separately calls our webhook (payment.succeeded / payment.failed).
//
// Server calls authenticate with the API *secret* key in the header
// X-SFPY-MERCHANT-SECRET. The *public* API key goes in the request body
// as merchant_api_key.
//
// Amounts: V2 wants the smallest currency unit (PKR 500 -> 50000).
// Everything else in this app keeps using whole rupees; the conversion
// happens only here (toMinorUnits).

export type SafepayEnvironment = "sandbox" | "production";

export interface SafepayConfig {
  environment: SafepayEnvironment;
  publicKey: string; // "Public API Key" (merchant_api_key) from the Safepay dashboard
  secretKey: string; // "API Secret Key" - server only, never sent to the browser
  intent: string; // CYBERSOURCE (default) or MPGS - whichever Safepay enabled on the account
}

export function readSafepayConfig(): { config: SafepayConfig | null; missing: string[] } {
  const environment = (process.env.SAFEPAY_ENVIRONMENT as SafepayEnvironment) === "production" ? "production" : "sandbox";
  // SAFEPAY_API_KEY is the variable the V1 code used; it held the public
  // "sec_..." key, so it keeps working as the public key here.
  const publicKey = process.env.SAFEPAY_PUBLIC_KEY || process.env.SAFEPAY_API_KEY || "";
  const secretKey = process.env.SAFEPAY_SECRET_KEY || "";
  const intent = (process.env.SAFEPAY_INTENT || "CYBERSOURCE").toUpperCase();
  const missing: string[] = [];
  if (!publicKey) missing.push("SAFEPAY_PUBLIC_KEY (or SAFEPAY_API_KEY)");
  if (!secretKey) missing.push("SAFEPAY_SECRET_KEY");
  if (missing.length) return { config: null, missing };
  return { config: { environment, publicKey, secretKey, intent }, missing };
}

function apiBase(environment: SafepayEnvironment): string {
  return environment === "production" ? "https://api.getsafepay.com" : "https://sandbox.api.getsafepay.com";
}

// Hosted checkout page. Taken from Safepay's Node SDK (@sfpy/node-core
// Checkout.js). Can be overridden with SAFEPAY_CHECKOUT_BASE without a
// code change if Safepay ever tells us a different address.
function checkoutBase(environment: SafepayEnvironment): string {
  const override = process.env.SAFEPAY_CHECKOUT_BASE;
  if (override) return override.endsWith("/") ? override : `${override}/`;
  return environment === "production"
    ? "https://getsafepay.com/embedded/"
    : "https://sandbox.api.getsafepay.com/embedded/";
}

// PKR 500 -> 50000. Whole-rupee fees only (the app never charges paisa).
export function toMinorUnits(amountPkr: number): number {
  return Math.round(amountPkr * 100);
}

async function safepayPost(config: SafepayConfig, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${apiBase(config.environment)}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SFPY-MERCHANT-SECRET": config.secretKey,
    },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

export interface SafepayCheckoutResult {
  tracker: string; // track_...
  checkoutUrl: string;
}

// Steps 1-3 above in one call.
export async function createSafepayCheckout(
  config: SafepayConfig,
  params: {
    amountPkr: number;
    orderId: string; // our own payments.id - comes back in the webhook metadata
    redirectUrl: string;
    cancelUrl: string;
  }
): Promise<SafepayCheckoutResult> {
  // 1. open the payment session
  const session = await safepayPost(config, "/order/payments/v3/", {
    merchant_api_key: config.publicKey,
    intent: config.intent,
    mode: "payment",
    entry_mode: "raw",
    currency: "PKR",
    amount: toMinorUnits(params.amountPkr),
    metadata: { order_id: params.orderId },
    include_fees: false,
  });
  const tracker = get(session.json, ["data", "tracker", "token"]);
  if (session.status >= 400 || typeof tracker !== "string" || !tracker) {
    throw new Error(`Safepay didn't open a payment session (HTTP ${session.status}): ${JSON.stringify(session.json)}`);
  }

  // 2. short-lived (1 hour) checkout pass
  const passport = await safepayPost(config, "/client/passport/v1/token", {});
  const dataField = get(passport.json, ["data"]);
  const tbt =
    typeof dataField === "string" ? dataField : typeof get(dataField, ["token"]) === "string" ? (get(dataField, ["token"]) as string) : "";
  if (passport.status >= 400 || !tbt) {
    throw new Error(`Safepay didn't issue a checkout pass (HTTP ${passport.status}): ${JSON.stringify(passport.json)}`);
  }

  // 3. hosted checkout address
  const query = new URLSearchParams({
    environment: config.environment,
    tracker,
    tbt,
    source: "hosted",
    redirect_url: params.redirectUrl,
    cancel_url: params.cancelUrl,
  });
  return { tracker, checkoutUrl: `${checkoutBase(config.environment)}?${query.toString()}` };
}

export interface SafepayTrackerInfo {
  state: string; // e.g. TRACKER_ENDED
  paid: boolean;
  amountMinor: number | null;
  orderId: string | null;
  raw: unknown;
}

// Asks Safepay directly what happened to a payment. This is the
// authoritative answer (it needs our secret key), so it is used both to
// confirm a patient's return from checkout and to double-check a webhook
// whose signature we couldn't verify.
export async function fetchSafepayTracker(config: SafepayConfig, tracker: string): Promise<SafepayTrackerInfo> {
  const res = await fetch(`${apiBase(config.environment)}/reporter/api/v1/payments/${encodeURIComponent(tracker)}`, {
    method: "GET",
    headers: { Accept: "application/json", "X-SFPY-MERCHANT-SECRET": config.secretKey },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(`Safepay payment lookup failed (HTTP ${res.status})`);
  }
  const data = (get(json, ["data"]) ?? {}) as Record<string, unknown>;
  const state =
    (typeof data.state === "string" && data.state) ||
    (typeof get(data, ["tracker", "state"]) === "string" ? (get(data, ["tracker", "state"]) as string) : "") ||
    "";

  // amount: purchase_totals.quote_amount.amount (minor units)
  const amountRaw = get(data, ["purchase_totals", "quote_amount", "amount"]);
  const amountMinor = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? Number(amountRaw) : null;

  // metadata comes back either as {order_id: "x"} or {order_id: {value: "x"}}
  const meta = (get(data, ["metadata"]) ?? {}) as Record<string, unknown>;
  const rawOrder = meta.order_id;
  const orderId =
    typeof rawOrder === "string"
      ? rawOrder
      : typeof get(rawOrder, ["value"]) === "string"
        ? (get(rawOrder, ["value"]) as string)
        : null;

  return {
    state,
    paid: state === "TRACKER_ENDED",
    amountMinor: amountMinor !== null && Number.isFinite(amountMinor) ? amountMinor : null,
    orderId,
    raw: json,
  };
}

// Webhook signature: HMAC-SHA512, hex, header X-SFPY-SIGNATURE, keyed with
// the endpoint's shared secret (Developers > Endpoints > View shared
// secret). Safepay's page doesn't say whether the signature covers the
// whole body or only its "data" part (V1 signed only "data"), so both are
// accepted — each is a keyed hash, so neither can be forged without the
// secret.
export function verifySafepayWebhookSignature(webhookSecret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!webhookSecret || !signatureHeader) return false;
  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signatureHeader.trim(), "hex");
  } catch {
    return false;
  }
  if (signatureBuf.length === 0) return false;

  const candidates: string[] = [rawBody];
  const rawData = extractRawJsonField(rawBody, "data");
  if (rawData) candidates.push(rawData);

  for (const text of candidates) {
    const expected = crypto.createHmac("sha512", webhookSecret).update(Buffer.from(text, "utf8")).digest();
    if (expected.length === signatureBuf.length && crypto.timingSafeEqual(expected, signatureBuf)) return true;
  }
  return false;
}

// Extracts the raw, unmodified JSON text of a top-level field from the
// original request body (bracket-matching, no re-serializing).
export function extractRawJsonField(rawBody: string, key: string): string | null {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*`);
  const match = keyPattern.exec(rawBody);
  if (!match) return null;

  let idx = match.index + match[0].length;
  while (idx < rawBody.length && /\s/.test(rawBody[idx])) idx++;
  const openChar = rawBody[idx];
  if (openChar !== "{" && openChar !== "[") return null;
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = idx; i < rawBody.length; i++) {
    const c = rawBody[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return rawBody.slice(idx, i + 1);
    }
  }
  return null;
}
