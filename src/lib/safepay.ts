import crypto from "crypto";

// Phase 10, step 1: a small, dependency-free client for the three
// Safepay (getsafepay.com) operations this app needs. Deliberately NOT
// using the official `@sfpy/node-sdk` npm package — it pulls in a very
// old axios version with several unpatched high-severity advisories
// (SSRF, prototype pollution) for the one HTTP call it makes. Instead,
// this reproduces that exact call with a plain `fetch` (already the
// pattern this codebase uses for Daily.co), matching what the SDK's own
// published source actually does field-for-field — verified directly
// against the package's source (v3.0.2), not guessed from marketing
// docs. The checkout-URL and webhook-signature logic below is likewise
// a faithful line-for-line port of that same source, using Node's
// built-in `crypto` instead of a dependency.
//
// What's still genuinely unconfirmed (can only be confirmed by an
// actual sandbox transaction, which needs the physician's real Safepay
// account — Section 41): the exact shape of a webhook's `data` payload
// beyond "there is one," and the exact terminal `state` string(s) a
// completed/failed transaction reports. The webhook handler that uses
// this module is written defensively for that reason and stores the
// full raw payload regardless, so a real test can be used to tighten
// the field-matching afterward if needed — flagged clearly rather than
// assumed correct on the first try.

export type SafepayEnvironment = "sandbox" | "production";

interface SafepayConfig {
  environment: SafepayEnvironment;
  apiKey: string; // the "secret"/merchant API key, e.g. sec_...
  webhookSecret: string;
}

function apiBase(environment: SafepayEnvironment): string {
  return environment === "production"
    ? "https://api.getsafepay.com"
    : "https://sandbox.api.getsafepay.com";
}

function checkoutBase(environment: SafepayEnvironment): string {
  return environment === "production"
    ? "https://getsafepay.com/checkout"
    : "https://sandbox.api.getsafepay.com/checkout";
}

export interface CreateSafepayPaymentResult {
  token: string; // e.g. track_...
  raw: unknown;
}

// Mirrors @sfpy/node-sdk's Payments.create(): POST {amount, client,
// currency, environment} to /order/v1/init, return the tracker token.
export async function createSafepayPayment(
  config: SafepayConfig,
  params: { amount: number; currency: "PKR" | "USD" }
): Promise<CreateSafepayPaymentResult> {
  const res = await fetch(`${apiBase(config.environment)}/order/v1/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: params.amount,
      client: config.apiKey,
      currency: params.currency,
      environment: config.environment,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.data?.token) {
    throw new Error(
      `Safepay didn't return a payment token (HTTP ${res.status}): ${JSON.stringify(body)}`
    );
  }
  return { token: body.data.token as string, raw: body.data };
}

// Mirrors @sfpy/node-sdk's Checkout.create(): builds the hosted checkout
// URL a patient's browser is redirected to.
export function buildSafepayCheckoutUrl(
  config: SafepayConfig,
  params: {
    token: string;
    orderId: string;
    cancelUrl: string;
    redirectUrl: string;
    source?: string;
    webhooks?: boolean;
  }
): string {
  const url = `${checkoutBase(config.environment)}/pay`;
  const query = new URLSearchParams({
    beacon: params.token,
    cancel_url: params.cancelUrl,
    env: config.environment,
    order_id: params.orderId,
    redirect_url: params.redirectUrl,
    source: params.source ?? "custom",
    webhooks: String(params.webhooks ?? false),
  });
  return `${url}?${query.toString()}`;
}

// Mirrors @sfpy/node-sdk's Verify.webhook(): the signature covers only
// the JSON-stringified `data` field of the webhook body (not the whole
// body), HMAC-SHA512, hex digest, header `x-sfpy-signature`.
export function verifySafepayWebhook(
  config: SafepayConfig,
  body: { data?: unknown },
  headers: Headers
): boolean {
  const signature = headers.get("x-sfpy-signature");
  if (!signature || body?.data === undefined) return false;
  const payload = Buffer.from(JSON.stringify(body.data));
  const expected = crypto.createHmac("sha512", config.webhookSecret).update(payload).digest("hex");
  // Constant-time compare to avoid a timing side-channel; falls back to
  // false on any length mismatch (timingSafeEqual throws otherwise).
  const expectedBuf = Buffer.from(expected, "hex");
  const signatureBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
