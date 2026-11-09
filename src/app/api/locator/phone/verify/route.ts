import { NextRequest, NextResponse } from "next/server";
import { codeHash, locatorClientIp, locatorServiceClient, makeLimiter, normalizePkPhone, signPhoneProof } from "@/lib/locatorServer";

// Checks the code. On success returns a short-lived proof the browser hands to the apply call.

export const maxDuration = 10;

const limited = makeLimiter(20, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
  try {
    if (limited(locatorClientIp(request))) return reply({ ok: false, error: "slow_down" }, 429);
    const text = await request.text();
    if (text.length > 256) return reply({ ok: false, error: "bad_request" }, 400);
    const b = JSON.parse(text) as Record<string, unknown>;
    const phone = normalizePkPhone(String(b.phone ?? ""));
    const code = String(b.code ?? "").replace(/\D/g, "");
    if (!phone || code.length !== 6) return reply({ ok: false, error: "bad_request" }, 400);
    const service = locatorServiceClient();
    if (!service) return reply({ ok: false, error: "unavailable" }, 503);
    const { data } = await service.rpc("locator_code_check", { p_phone: phone, p_hash: codeHash(phone, code) });
    if (data !== true) return reply({ ok: false, error: "wrong_code" });
    return reply({ ok: true, proof: signPhoneProof(phone), phone });
  } catch {
    return reply({ ok: false, error: "bad_request" }, 400);
  }
}
