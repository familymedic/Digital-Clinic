import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { credentialOption } from "@/lib/credentials";

// Doctor credential requests (2026-10-08). A doctor asks for MBBS / RMP /
// MCPS / FCPS / ... to be shown next to their name. This route only ever
// creates a 'pending_review' request for the CALLER'S OWN account — an
// admin approving it (Admin → Credentials) is what makes it public.
// Postgraduate qualifications must come with evidence; MBBS/BDS/RMP are
// checked by the admin against the PMDC certificate already on file.
// Same caller's-own-token re-check pattern as every other privileged route.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // hosting rejects larger request bodies anyway
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(request: NextRequest) {
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
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "This needs the Supabase service-role key configured on the server first." },
      { status: 503 }
    );
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: doctorRow, error: doctorError } = await serviceClient
    .from("doctor_profiles")
    .select("verification_status, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (doctorError) return NextResponse.json({ error: doctorError.message }, { status: 500 });
  if (!doctorRow || doctorRow.verification_status !== "approved" || !doctorRow.is_active) {
    return NextResponse.json({ error: "Only an approved, active doctor account can request credentials." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });

  const code = String(form.get("credential") ?? "").trim();
  const detail = String(form.get("detail") ?? "").trim();
  const evidence = form.get("evidence");

  const option = credentialOption(code);
  if (!option) return NextResponse.json({ error: "Please choose a credential from the list." }, { status: 400 });
  if (detail.length > 40) {
    return NextResponse.json({ error: "Please keep the subject under 40 characters." }, { status: 400 });
  }

  const hasFile = evidence instanceof File && evidence.size > 0;
  if (option.needsEvidence && !hasFile) {
    return NextResponse.json(
      { error: `${option.code} needs proof. Please attach your certificate (from CPSP or the awarding body), or your PMDC registration showing this qualification.` },
      { status: 400 }
    );
  }
  if (hasFile) {
    if (evidence.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "The file is too large (max 4MB). Please upload a smaller scan or photo." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(evidence.type)) {
      return NextResponse.json({ error: "The file must be a JPG, PNG, WEBP, or PDF." }, { status: 400 });
    }
  }

  // Already requested / approved?
  const { data: dupes, error: dupeError } = await serviceClient
    .from("doctor_credentials")
    .select("id, detail, status")
    .eq("doctor_id", user.id)
    .eq("credential", option.code)
    .in("status", ["pending_review", "approved"]);
  if (dupeError) return NextResponse.json({ error: dupeError.message }, { status: 500 });
  if ((dupes ?? []).some((r) => (r.detail ?? "") === detail)) {
    return NextResponse.json(
      { error: `You already have ${option.code}${detail ? ` (${detail})` : ""} approved or waiting for review.` },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertError } = await serviceClient
    .from("doctor_credentials")
    .insert({
      doctor_id: user.id,
      credential: option.code,
      detail: detail || null,
      status: "pending_review",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Couldn't save your request." }, { status: 500 });
  }

  if (hasFile) {
    const ext = evidence.type === "application/pdf" ? "pdf" : evidence.type.split("/")[1] ?? "bin";
    const path = `${user.id}/credentials/${inserted.id}.${ext}`;
    const bytes = new Uint8Array(await evidence.arrayBuffer());
    const { error: uploadError } = await serviceClient.storage
      .from("doctor-documents")
      .upload(path, bytes, { contentType: evidence.type, upsert: true });
    if (uploadError) {
      // Don't leave a request that can't be reviewed.
      await serviceClient.from("doctor_credentials").delete().eq("id", inserted.id);
      return NextResponse.json({ error: `Couldn't upload your file: ${uploadError.message}` }, { status: 502 });
    }
    const { error: pathError } = await serviceClient
      .from("doctor_credentials")
      .update({ evidence_path: path })
      .eq("id", inserted.id);
    if (pathError) {
      await serviceClient.from("doctor_credentials").delete().eq("id", inserted.id);
      return NextResponse.json({ error: pathError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
