// Server-only helpers for quick-booking guests: saved appointment links,
// the patient's PIN, rate limits, and handing a guest a normal session.
//
// Design rules (so nothing here can weaken the rest of the app):
//  - A guest always ends up with a NORMAL Supabase session. Every page and
//    permission rule (RLS) then works exactly as for any other patient.
//  - Only accounts created by quick booking are ever touched: is_guest, never
//    converted to a real password, never anonymised.
//  - A saved link carries no secret of its own in the database: it is a signed
//    pointer (account + consultation). It stops working when the guest's
//    access window ends, when the account is converted/removed, or if the
//    server's service-role key is ever rotated.
//  - The PIN is stored hashed (scrypt). Guessing is stopped by lockouts
//    (per mobile number and per network address), not by the PIN being hard.

import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GUEST_ACCESS_DAYS, GUEST_PIN_MAX_LENGTH, GUEST_PIN_MIN_LENGTH } from "@/lib/quickBooking";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- PIN

const WEAK_PINS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "1212", "2121", "1122", "2211", "1004", "2000", "2580", "0852",
  "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999",
  "123456", "654321", "123123", "121212", "112233", "000111", "123321", "159753", "010203",
]);

// Returns an error message the patient can read, or null if the PIN is fine.
export function checkPin(pin: unknown, phoneNorm?: string): string | null {
  const p = String(pin ?? "");
  if (!new RegExp(`^\\d{${GUEST_PIN_MIN_LENGTH},${GUEST_PIN_MAX_LENGTH}}$`).test(p)) {
    return `Please choose a PIN of ${GUEST_PIN_MIN_LENGTH} to ${GUEST_PIN_MAX_LENGTH} digits (numbers only).`;
  }
  if (WEAK_PINS.has(p)) return "That PIN is too easy to guess. Please choose a different one.";
  if (phoneNorm && p.length >= 4 && phoneNorm.endsWith(p)) {
    return "Please don't use the end of your mobile number as your PIN.";
  }
  return null;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `s1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  // Always do the same amount of work, even when there is nothing stored.
  const parts = (stored ?? "").split("$");
  const ok = parts.length === 3 && parts[0] === "s1";
  const salt = ok ? Buffer.from(parts[1], "base64url") : Buffer.alloc(16);
  const expected = ok ? Buffer.from(parts[2], "base64url") : Buffer.alloc(32);
  const actual = crypto.scryptSync(pin, salt, 32);
  return ok && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------- saved links

function linkKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update("family-medic/appointment-link/v1").digest();
}

function uuidToBytes(id: string): Buffer | null {
  const hex = id.replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// token = base64url(account uuid + consultation uuid) [43 chars]
//       + base64url(first 16 bytes of HMAC)            [22 chars]
export function makeAppointmentToken(accountId: string, consultationId: string): string | null {
  const key = linkKey();
  const a = uuidToBytes(accountId);
  const c = uuidToBytes(consultationId);
  if (!key || !a || !c) return null;
  const payload = Buffer.concat([a, c]);
  const sig = crypto.createHmac("sha256", key).update(payload).digest().subarray(0, 16);
  return payload.toString("base64url") + sig.toString("base64url");
}

export function readAppointmentToken(token: string): { accountId: string; consultationId: string } | null {
  const key = linkKey();
  if (!key || typeof token !== "string" || token.length !== 65 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const payload = Buffer.from(token.slice(0, 43), "base64url");
  const sig = Buffer.from(token.slice(43), "base64url");
  if (payload.length !== 32 || sig.length !== 16) return null;
  const expected = crypto.createHmac("sha256", key).update(payload).digest().subarray(0, 16);
  if (!crypto.timingSafeEqual(sig, expected)) return null;
  return { accountId: bytesToUuid(payload.subarray(0, 16)), consultationId: bytesToUuid(payload.subarray(16)) };
}

// ---------------------------------------------------------------- eligibility

export interface GuestStatus {
  ok: boolean;
  reason?: "not_found" | "not_guest" | "converted" | "removed" | "expired";
  email?: string;
  accessUntil?: Date;
}

// Is this account a live quick-booking guest, and is its access window open?
export async function getGuestStatus(service: SupabaseClient, accountId: string): Promise<GuestStatus> {
  const { data: userRes, error: userErr } = await service.auth.admin.getUserById(accountId);
  const user = userRes?.user;
  if (userErr || !user) return { ok: false, reason: "not_found" };
  if (user.user_metadata?.is_guest !== true) return { ok: false, reason: "not_guest" };

  const { data: self } = await service
    .from("family_members")
    .select("guest_created_at, guest_converted_at, anonymized_at")
    .eq("account_id", accountId)
    .eq("relationship", "self")
    .maybeSingle();
  const row = self as { guest_created_at: string | null; guest_converted_at: string | null; anonymized_at: string | null } | null;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.guest_converted_at) return { ok: false, reason: "converted" };
  if (row.anonymized_at) return { ok: false, reason: "removed" };

  const { data: endRaw } = await service.rpc("guest_last_appointment_end", { p_account_id: accountId });
  const base = endRaw
    ? new Date(String(endRaw))
    : row.guest_created_at
      ? new Date(row.guest_created_at)
      : new Date();
  const accessUntil = new Date(base.getTime() + GUEST_ACCESS_DAYS * DAY_MS);
  if (Date.now() > accessUntil.getTime()) return { ok: false, reason: "expired", accessUntil };
  return { ok: true, email: user.email ?? undefined, accessUntil };
}

// Gives the guest a fresh one-time password so the browser can sign in with
// the ordinary email + password call. The password is random, never stored
// anywhere by us, and never shown to anyone. Only call after getGuestStatus
// says ok (a converted guest has a REAL password that must never be replaced).
export async function issueGuestSignIn(
  service: SupabaseClient,
  accountId: string,
  email: string
): Promise<{ email: string; password: string } | null> {
  const password = crypto.randomBytes(24).toString("base64url");
  const { error } = await service.auth.admin.updateUserById(accountId, { password });
  if (error) return null;
  return { email, password };
}

// ---------------------------------------------------------------- rate limits

export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip")) ?? "";
  return ip.trim() || "unknown";
}

// Keys are hashed so raw numbers / addresses are not kept in the table.
export function throttleKey(kind: string, value: string): string {
  return `${kind}:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

// Counts an attempt; returns false when over the limit. Fails OPEN if the
// table is unavailable, so a throttle problem can never block a real patient.
export async function allowAttempt(
  service: SupabaseClient,
  key: string,
  max: number,
  windowSecs: number
): Promise<boolean> {
  const { data, error } = await service.rpc("access_throttle_hit", {
    p_key: key,
    p_max: max,
    p_window_secs: windowSecs,
  });
  if (error) return true;
  return data !== false;
}

export async function lockedSeconds(service: SupabaseClient, key: string): Promise<number> {
  const { data, error } = await service.rpc("access_throttle_locked", { p_key: key });
  if (error) return 0;
  return Number(data) || 0;
}

export async function recordFailure(
  service: SupabaseClient,
  key: string,
  max: number,
  windowSecs: number,
  lockSecs: number
): Promise<void> {
  await service.rpc("access_throttle_fail", {
    p_key: key,
    p_max: max,
    p_window_secs: windowSecs,
    p_lock_secs: lockSecs,
  });
}

export async function clearFailures(service: SupabaseClient, key: string): Promise<void> {
  await service.rpc("access_throttle_clear", { p_key: key });
}
