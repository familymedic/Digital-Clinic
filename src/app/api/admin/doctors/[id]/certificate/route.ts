import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Doctor onboarding, step 1: lets an admin view a pending applicant's
// scanned PMDC certificate. The "doctor-documents" storage bucket
// (0027) is private with zero storage policies — a browser can't reach
// it directly no matter who's signed in — so this route is the only
// door in. Same caller's-own-token re-check pattern as every other
// privileged route in this app: verify the caller is a real admin via
// RLS before ever touching the service-role client.
//
// Doctor public profile (2026-09-15): a doctor's scanned CNIC lives in
// this same private bucket (0034) — reused rather than duplicated, via
// an optional ?type=cnic query param (defaults to "pmdc" so every
// existing caller is unaffected).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: doctorId } = await params;
  const docType = request.nextUrl.searchParams.get("type") === "cnic" ? "cnic" : "pmdc";

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

  const { data: doctorRow, error: doctorError } = await serviceClient
    .from("doctor_profiles")
    .select("pmdc_certificate_path, cnic_certificate_path")
    .eq("id", doctorId)
    .maybeSingle();

  if (doctorError) {
    return NextResponse.json({ error: doctorError.message }, { status: 500 });
  }
  const path = docType === "cnic" ? doctorRow?.cnic_certificate_path : doctorRow?.pmdc_certificate_path;
  if (!path) {
    return NextResponse.json(
      { error: docType === "cnic" ? "No CNIC on file for this doctor." : "No certificate on file for this doctor." },
      { status: 404 }
    );
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from("doctor-documents")
    .createSignedUrl(path, 300); // 5 minutes — just long enough to view, not a permanent link

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signError?.message ?? "Couldn't generate a link to the certificate." },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
