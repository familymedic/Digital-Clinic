import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveMapsUrl } from "@/lib/locatorMapsServer";

// Admin only: opens up to 20 Google Maps short links from a vaccination-centre upload and returns the
// pin for each. The caller's own login token is checked against admin_profiles. The links are opened
// by the same safe resolver the public pin picker uses (Google Maps addresses only).

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: admin } = await service.from("admin_profiles").select("id").eq("id", user.id).maybeSingle();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  let urls: string[] = [];
  try {
    const b = (await request.json()) as { urls?: unknown };
    if (Array.isArray(b.urls)) urls = b.urls.filter((u): u is string => typeof u === "string" && u.length <= 400);
  } catch {
    // fall through
  }
  if (!urls.length || urls.length > 20) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const results: ({ lat: number; lng: number } | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const r = await resolveMapsUrl(urls[i]);
      results[i] = r.ok ? { lat: r.lat, lng: r.lng } : null;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return NextResponse.json({ results });
}
