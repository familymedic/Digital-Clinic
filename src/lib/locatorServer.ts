import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "crypto";

// Server-only helpers for the Locator routes (migration 0095).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function locatorServiceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function locatorClientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip")) ?? "";
  return ip.trim() || "unknown";
}

// Best-effort per-instance limiter. Stops a runaway script or casual abuse without adding
// database load; it is not a security boundary (the database has its own limits and every
// public suggestion waits for admin approval).
export function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return function limited(key: string): boolean {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 8000) hits.clear();
      return false;
    }
    h.n += 1;
    return h.n > max;
  };
}

// ---- manage link token: the browser holds the raw token, the database only its hash ----
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function looksLikeToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw);
}

// ---- phone verification (pluggable) ----
// There is no SMS service wired into the site. If LOCATOR_SMS_WEBHOOK_URL is set (a small
// endpoint that accepts {to, text} and sends the message, e.g. a gateway account), codes are
// delivered through it; otherwise phone verification is simply "unavailable" and the sign-up
// carries on with the phone marked "not verified" so an admin can call back.
export function smsConfigured(): boolean {
  return Boolean(process.env.LOCATOR_SMS_WEBHOOK_URL);
}

export async function sendSms(to: string, text: string): Promise<boolean> {
  const url = process.env.LOCATOR_SMS_WEBHOOK_URL;
  if (!url) return false;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.LOCATOR_SMS_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.LOCATOR_SMS_WEBHOOK_TOKEN}`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ to, text }), signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

function secret(): string {
  return createHash("sha256").update(`locator-phone:${SERVICE_KEY ?? "dev"}`).digest("hex");
}

export function normalizePkPhone(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, "");
  if (/^03\d{9}$/.test(d)) return d;
  if (/^923\d{9}$/.test(d)) return `0${d.slice(2)}`;
  if (/^3\d{9}$/.test(d)) return `0${d}`;
  return null; // mobile numbers only for codes
}

export function codeHash(phone: string, code: string): string {
  return createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
}

// Proof that a phone was verified in the last 30 minutes, carried by the browser to the apply call.
export function signPhoneProof(phone: string): string {
  const exp = Date.now() + 30 * 60 * 1000;
  const body = `${phone}.${exp}`;
  const mac = createHmac("sha256", secret()).update(`proof:${body}`).digest("hex").slice(0, 32);
  return `${body}.${mac}`;
}

export function checkPhoneProof(phone: string, proof: unknown): boolean {
  if (typeof proof !== "string") return false;
  const parts = proof.split(".");
  if (parts.length !== 3) return false;
  const [p, exp, mac] = parts;
  if (p !== phone || !Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return false;
  const want = createHmac("sha256", secret()).update(`proof:${p}.${exp}`).digest("hex").slice(0, 32);
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(want));
  } catch {
    return false;
  }
}
