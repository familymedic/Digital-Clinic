import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  checkPhoneProof, hashToken, locatorClientIp, locatorServiceClient, makeLimiter, normalizePkPhone,
} from "@/lib/locatorServer";
import { inPilot, ownerKindCategory } from "@/lib/locator";

// "List your workplace": an owner applies. The place is saved NOT public. Clinics, labs,
// hospitals and therapy centres wait for an admin to check their documents; pharmacies need
// no check. Either way the place only shows up once the annual fee is paid. The browser gets a
// private manage link (a random token; only its hash is stored here).

export const maxDuration = 15;

const limited = makeLimiter(6, 60 * 60 * 1000);
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 4096) return bad("bad_request");
    const b = JSON.parse(text) as Record<string, unknown>;
    if (typeof b.website === "string" && b.website.trim() !== "") return NextResponse.json({ ok: true }); // honeypot

    const kind = String(b.kind ?? "");
    const category = ownerKindCategory(kind);
    if (!category) return bad("bad_request");
    const name = clip(b.name, 120);
    const area = clip(b.area, 80);
    if (name.length < 2 || area.length < 2) return bad("missing_fields");
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad("need_location");
    if (!inPilot(lat, lng)) return bad("outside_pilot");
    if (b.consent !== true) return bad("consent_required");
    const ownerName = clip(b.ownerName, 80);
    const ownerPhoneRaw = clip(b.ownerPhone, 30);
    if (ownerName.length < 2 || ownerPhoneRaw.replace(/\D/g, "").length < 10) return bad("need_contact");
    const mobile = normalizePkPhone(ownerPhoneRaw);
    const phoneVerified = Boolean(mobile && checkPhoneProof(mobile, b.phoneProof));
    const email = clip(b.ownerEmail, 120);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("bad_email");

    const service = locatorServiceClient();
    if (!service) return bad("unavailable", 503);
    const raw = randomBytes(32).toString("hex");
    const { data, error } = await service.rpc("locator_apply_place", {
      p_category: category,
      p_kind: kind,
      p_name: name,
      p_area: area,
      p_address: clip(b.address, 240) || null,
      p_phone: clip(b.phone, 30) || null,
      p_notes: clip(b.notes, 400) || null,
      p_lat: lat,
      p_lng: lng,
      p_owner_name: ownerName,
      p_owner_phone: ownerPhoneRaw,
      p_owner_email: email || null,
      p_registration: clip(b.registration, 300) || null,
      p_phone_verified: phoneVerified,
      p_token_hash: hashToken(raw),
      p_consent: true,
    });
    if (error) {
      const m = String(error.message);
      if (m.includes("duplicate")) return bad("duplicate", 409);
      if (m.includes("queue_full")) return bad("queue_full", 503);
      if (m.includes("outside_pilot")) return bad("outside_pilot");
      if (m.includes("consent_required")) return bad("consent_required");
      return bad("unavailable", 503);
    }
    await service.rpc("locator_event", { p_event: "apply", p_category: category });
    const r = data as { id: string; requires_verification: boolean; fee_pkr: number };
    return NextResponse.json({
      ok: true,
      token: raw,
      requiresVerification: r.requires_verification,
      feePkr: r.fee_pkr,
      phoneVerified,
    });
  } catch {
    return bad("bad_request");
  }
}
