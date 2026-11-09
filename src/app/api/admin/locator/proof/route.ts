import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin only: a short-lived signed link to open one proof file of a workplace application.
// The caller's own login token is checked against admin_profiles; files live in a private bucket.

export const maxDuration = 10;

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

  let path = "";
  try {
    const b = (await request.json()) as { path?: unknown };
    path = typeof b.path === "string" ? b.path : "";
  } catch {
    // fall through
  }
  if (!/^[0-9a-f-]{36}\/[\w.-]{1,80}$/i.test(path)) return NextResponse.json({ error: "bad path" }, { status: 400 });
  // the path must belong to a real place's proof list
  const { data: place } = await service.from("locator_places").select("id").contains("proof_paths", [path]).maybeSingle();
  if (!place) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await service.storage.from("locator-proofs").createSignedUrl(path, 300);
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ url: data.signedUrl });
}
