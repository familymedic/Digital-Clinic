import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordEvent } from "@/lib/serverTelemetry";

// Step 2 of doctor sign-up (2026-10-08): the PMDC certificate upload.
// Doctors on weak mobile connections kept losing their whole application
// because the details AND the certificate travelled in one big request.
// Now the application details are saved first (/api/doctors/register, a
// tiny request) and the certificate comes here, on its own, where it can be
// retried as many times as needed without creating anything twice.
//
// Only the CALLER'S OWN application can be touched (token re-verified like
// every privileged route), and only while it is still waiting for review or
// has no certificate on file yet.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
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
    return NextResponse.json({ error: "Your session isn't valid — please sign in again." }, { status: 401 });
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: row, error: rowError } = await serviceClient
    .from("doctor_profiles")
    .select("verification_status, pmdc_certificate_path")
    .eq("id", user.id)
    .maybeSingle();
  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  if (!row) {
    return NextResponse.json({ error: "We couldn't find a doctor application for this account." }, { status: 404 });
  }
  if (row.verification_status !== "pending_review" && row.pmdc_certificate_path) {
    return NextResponse.json({ error: "Your application has already been reviewed." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const certificate = form?.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) {
    return NextResponse.json({ error: "Please attach your scanned PMDC certificate." }, { status: 400 });
  }
  if (certificate.size > MAX_BYTES) {
    return NextResponse.json({ error: "The file is too large (max 4MB). Please choose a smaller photo or PDF." }, { status: 400 });
  }
  if (!ALLOWED.includes(certificate.type)) {
    return NextResponse.json({ error: "The certificate must be a JPG, PNG, WEBP, or PDF file." }, { status: 400 });
  }

  const ext = certificate.type === "application/pdf" ? "pdf" : certificate.type.split("/")[1] ?? "bin";
  const path = `${user.id}/pmdc-certificate.${ext}`;
  const bytes = new Uint8Array(await certificate.arrayBuffer());
  const { error: uploadError } = await serviceClient.storage
    .from("doctor-documents")
    .upload(path, bytes, { contentType: certificate.type, upsert: true });
  if (uploadError) {
    await recordEvent(
      serviceClient,
      { source: "server", kind: "server_error", label: "/api/doctors/register/certificate", message: "certificate upload failed" },
      request.nextUrl.origin
    );
    return NextResponse.json({ error: `Couldn't save your certificate: ${uploadError.message}. Please try again.` }, { status: 502 });
  }
  const { error: updateError } = await serviceClient
    .from("doctor_profiles")
    .update({ pmdc_certificate_path: path })
    .eq("id", user.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
