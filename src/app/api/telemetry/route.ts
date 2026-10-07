import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordEvent } from "@/lib/serverTelemetry";

// Receives lag / error reports from the browser (see src/lib/telemetry.ts).
// Public on purpose (a visitor who is not logged in can still hit a lag),
// so it is defensive: tiny body cap, strict allow-lists, a per-IP rate
// limit, and it ALWAYS answers 204 — a reporting problem must never show
// up as an error to a patient or doctor.

export const maxDuration = 15;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const KINDS = new Set(["slow", "fail", "timeout", "js_error"]);
const MAX_BODY = 4096;

// Best-effort per-instance limiter (30 reports/minute/IP). Enough to stop a
// runaway client or casual abuse; not a security boundary.
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > 30;
}

const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" && v ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : null;

export async function POST(request: NextRequest) {
  const done = () => new NextResponse(null, { status: 204 });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return done();

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (limited(ip)) return done();

    const text = await request.text();
    if (text.length > MAX_BODY) return done();
    const b = JSON.parse(text) as Record<string, unknown>;

    const kind = String(b.kind ?? "");
    const label = clip(b.label, 120);
    if (!KINDS.has(kind) || !label) return done();
    // Labels are paths ("/api/..") or "supabase/rest/v1/.." — nothing else.
    if (!label.startsWith("/") && !label.startsWith("supabase/") && label !== "unknown" && label !== "window") return done();

    const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await recordEvent(
      service,
      {
        source: "client",
        kind: kind as "slow" | "fail" | "timeout" | "js_error",
        label,
        message: clip(b.message, 200),
        durationMs: typeof b.durationMs === "number" && Number.isFinite(b.durationMs) ? Math.max(0, Math.min(Math.round(b.durationMs), 600_000)) : null,
        page: clip(b.page, 120),
        effectiveType: clip(b.effectiveType, 12),
        saveData: typeof b.saveData === "boolean" ? b.saveData : null,
        online: typeof b.online === "boolean" ? b.online : null,
        userAgent: clip(b.ua, 200),
      },
      request.nextUrl.origin
    );
  } catch {
    // swallow — see header comment
  }
  return done();
}
