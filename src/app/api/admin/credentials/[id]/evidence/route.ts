import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Lets an admin open the evidence file attached to a credential request
// (2026-10-08). The "doctor-documents" bucket is private with zero storage
// policies, so this route is the only door in — it re-checks that the
// caller is a real admin (via RLS) before touching the service-role
// client, then returns a 5-minute signed link.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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
  if (adminError) return NextResponse.json({ error: adminError.message }, { status: 500 });
  if (!adminRow) return NextResponse.json({ error: "Only an admin account can do this." }, { status: 403 });

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "This needs the Supabase service-role key configured on the server first." },
      { status: 503 }
    );
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: row, error: rowError } = await serviceClient
    .from("doctor_credentials")
    .select("evidence_path")
    .eq("id", id)
    .maybeSingle();
  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  if (!row?.evidence_path) {
    return NextResponse.json({ error: "No evidence file is attached to this request." }, { status: 404 });
  }
  const { data: signed, error: signError } = await serviceClient.storage
    .from("doctor-documents")
    .createSignedUrl(row.evidence_path, 300);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: signError?.message ?? "Couldn't generate a link to the file." }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl });
}
