import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sponsored ads, per-ad actions (2026-09-15). Pausing/resuming an ad is
// a plain column update the admin's own RLS policy already allows
// directly from the client (see /admin/ads) — no route needed for that.
// Deleting one is here instead, purely because it also has to remove the
// uploaded file from the "sponsored-ads" storage bucket, and every
// bucket in this app (zero storage policies, by design) can only ever be
// touched by a service-role route.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 });
  }

  const { data: adminRow, error: adminError } = await userClient
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (adminError) {
    return NextResponse.json({ error: adminError.message }, { status: 500 });
  }
  if (!adminRow) {
    return NextResponse.json({ error: "Only an admin account can do this." }, { status: 403 });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "This needs the Supabase service-role key configured on the server first." },
      { status: 503 }
    );
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: adRow, error: fetchError } = await serviceClient
    .from("sponsored_ads")
    .select("image_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!adRow) {
    return NextResponse.json({ error: "That ad no longer exists." }, { status: 404 });
  }

  const { error: deleteRowError } = await serviceClient.from("sponsored_ads").delete().eq("id", id);
  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  // Best-effort cleanup — the ad record is already gone (what actually
  // matters), so a storage removal failure here is logged, not fatal.
  const { error: removeError } = await serviceClient.storage.from("sponsored-ads").remove([adRow.image_path]);
  if (removeError) {
    console.error(`Deleted sponsored_ads row ${id} but couldn't remove its storage file:`, removeError.message);
  }

  return NextResponse.json({ success: true });
}
