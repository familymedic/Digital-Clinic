import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { codeHash, locatorClientIp, locatorServiceClient, makeLimiter, normalizePkPhone, sendSms, smsConfigured } from "@/lib/locatorServer";

// Sends a 6-digit code to a Pakistani mobile so a workplace owner can prove the number is
// theirs. If no SMS gateway is configured the answer is "unavailable" and the sign-up goes on
// without it (the number is stored as not verified and an admin can call back).

export const maxDuration = 15;

const limited = makeLimiter(8, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
  try {
    if (limited(locatorClientIp(request))) return reply({ ok: false, error: "slow_down" }, 429);
    if (!smsConfigured()) return reply({ ok: false, error: "unavailable" });
    const text = await request.text();
    if (text.length > 256) return reply({ ok: false, error: "bad_request" }, 400);
    const b = JSON.parse(text) as Record<string, unknown>;
    const phone = normalizePkPhone(String(b.phone ?? ""));
    if (!phone) return reply({ ok: false, error: "bad_phone" }, 400);
    const service = locatorServiceClient();
    if (!service) return reply({ ok: false, error: "unavailable" }, 503);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { data } = await service.rpc("locator_code_issue", { p_phone: phone, p_hash: codeHash(phone, code) });
    if (data === "too_soon") return reply({ ok: false, error: "too_soon" }, 429);
    if (data === "too_many") return reply({ ok: false, error: "too_many" }, 429);
    if (data !== "ok") return reply({ ok: false, error: "unavailable" }, 503);
    const sent = await sendSms(phone, `Family Medic: your code is ${code}. It works for 10 minutes. Do not share it.`);
    return reply(sent ? { ok: true } : { ok: false, error: "unavailable" });
  } catch {
    return reply({ ok: false, error: "bad_request" }, 400);
  }
}

// Lets the sign-up form know whether phone codes can be delivered at all (so it never shows a dead button).
export async function GET() {
  return NextResponse.json({ sms: smsConfigured() });
}
