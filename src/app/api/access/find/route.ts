import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";
import {
  clearFailures,
  clientIp,
  getGuestStatus,
  issueGuestSignIn,
  lockedSeconds,
  recordFailure,
  throttleKey,
  verifyPin,
} from "@/lib/guestAccess";

// "Find my appointment": mobile number + the PIN the patient chose after
// paying. A mobile number alone is never enough (it isn't a secret, and the
// appointments can be sensitive), and guessing is stopped by lockouts on both
// the number and the network address. Every failure gives the same answer, so
// this can't be used to find out whether a number has an account.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PHONE_MAX = 5; // wrong PINs per number ...
const IP_MAX = 15; // ... and per network address
const WINDOW_SECS = 15 * 60;
const LOCK_SECS = 30 * 60;

const NOT_FOUND = {
  error:
    "We couldn't find an appointment with that mobile number and PIN. Please check them and try again. If you saved your appointment link, you can open that instead.",
};

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  const pin = String(body?.pin ?? "");
  if (!phone || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(NOT_FOUND, { status: 400 });
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const phoneKey = throttleKey("find-ph", phone.norm);
  const ipKey = throttleKey("find-ip", clientIp(request));

  const locked = Math.max(await lockedSeconds(service, phoneKey), await lockedSeconds(service, ipKey));
  if (locked > 0) {
    return NextResponse.json(
      {
        error: `Too many wrong tries. Please wait about ${Math.ceil(locked / 60)} minutes, or open the appointment link you saved.`,
      },
      { status: 429 }
    );
  }

  const { data: rows } = await service
    .from("guest_access")
    .select("account_id, pin_hash, created_at")
    .eq("phone_norm", phone.norm)
    .not("pin_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const candidates = (rows ?? []) as { account_id: string; pin_hash: string; created_at: string }[];

  let matched: { email: string; accountId: string } | null = null;
  if (candidates.length === 0) {
    verifyPin(pin, null); // same work whether or not the number is known
  }
  for (const c of candidates) {
    if (!verifyPin(pin, c.pin_hash)) continue;
    const status = await getGuestStatus(service, c.account_id);
    if (status.ok && status.email) {
      matched = { email: status.email, accountId: c.account_id };
      break; // newest first, so the most recent booking wins
    }
  }

  if (!matched) {
    await recordFailure(service, phoneKey, PHONE_MAX, WINDOW_SECS, LOCK_SECS);
    await recordFailure(service, ipKey, IP_MAX, WINDOW_SECS, LOCK_SECS);
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const signIn = await issueGuestSignIn(service, matched.accountId, matched.email);
  if (!signIn) {
    return NextResponse.json({ error: "Couldn't open your appointment. Please try again." }, { status: 502 });
  }
  await clearFailures(service, phoneKey);
  return NextResponse.json({ ...signIn, next: "/dashboard" });
}
