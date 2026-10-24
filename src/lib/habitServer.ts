import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only helpers for the Habit Age routes (migration 0084).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function habitServiceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function habitAnonClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function habitClientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip")) ?? "";
  return ip.trim() || "unknown";
}

// Best-effort per-instance limiter. Enough to stop a runaway script or casual
// abuse without adding any database load; it is not a security boundary (the
// database also only ever stores anonymous counts).
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
