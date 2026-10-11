import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SPECIALTIES } from "@/lib/specialties";

// Doctor specialty change request (2026-10-11). A doctor who registered under
// the wrong specialty — or who has since been certified in a different one —
// can ask ONCE to change it. This route only ever creates a 'pending' request
// for the CALLER'S OWN account; an admin approving it (Admin → Specialty
// changes) is what actually changes the specialty. One approved change per
// doctor is also enforced by the database itself (migration 0070).
// Same caller's-own-token re-check pattern as every other privileged route.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MIN_REASON = 10;
const MAX_REASON = 500;

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
    .select("verification_status, is_active, specialty")
    .eq("id", user.id)
    .maybeSingle();
  if (doctorError) return NextResponse.json({ error: doctorError.message }, { status: 500 });
  if (!doctorRow || doctorRow.verification_status !== "approved" || !doctorRow.is_active) {
    return NextResponse.json({ error: "Only an approved, active doctor account can request a specialty change." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });

  const toSpecialty = String(form.get("specialty") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const evidence = form.get("evidence");

  if (!SPECIALTIES.includes(toSpecialty as (typeof SPECIALTIES)[number])) {
    return NextResponse.json({ error: "Please choose a specialty from the list." }, { status: 400 });
  }
  if (toSpecialty === (doctorRow.specialty ?? "")) {
    return NextResponse.json({ error: "That is already your specialty — please choose a different one." }, { status: 400 });
  }
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      { error: `Please briefly explain the change (at least ${MIN_REASON} characters) so the admin can review it.` },
      { status: 400 }
    );
  }
  if (reason.length > MAX_REASON) {
    return NextResponse.json({ error: `Please keep your reason under ${MAX_REASON} characters.` }, { status: 400 });
  }

  const hasFile = evidence instanceof File && evidence.size > 0;
  if (hasFile) {
    if (evidence.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "The file is too large (max 4MB). Please upload a smaller scan or photo." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(evidence.type)) {
      return NextResponse.json({ error: "The file must be a JPG, PNG, WEBP, or PDF." }, { status: 400 });
    }
  }

  // One change per doctor, and only one request waiting at a time.
  const { data: existing, error: existingError } = await serviceClient
    .from("doctor_specialty_changes")
    .select("status")
    .eq("doctor_id", user.id)
    .in("status", ["pending", "approved"]);
  if (existingError) {
    const missing = /doctor_specialty_changes/.test(existingError.message);
    return NextResponse.json(
      { error: missing ? "Specialty changes aren't switched on yet. Please try again later." : existingError.message },
      { status: missing ? 503 : 500 }
    );
  }
  if ((existing ?? []).some((r) => r.status === "approved")) {
    return NextResponse.json({ error: "You have already used your one specialty change." }, { status: 409 });
  }
  if ((existing ?? []).some((r) => r.status === "pending")) {
    return NextResponse.json({ error: "You already have a specialty change waiting for review." }, { status: 409 });
  }

  const { data: inserted, error: insertError } = await serviceClient
    .from("doctor_specialty_changes")
    .insert({
      doctor_id: user.id,
      from_specialty: doctorRow.specialty ?? null,
      to_specialty: toSpecialty,
      reason,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    // The database's own one-pending / one-approved rules land here if two
    // requests race each other.
    const duplicate = /duplicate key|unique/i.test(insertError?.message ?? "");
    return NextResponse.json(
      { error: duplicate ? "You already have a specialty change waiting for review, or have used your one change." : (insertError?.message ?? "Couldn't save your request.") },
      { status: duplicate ? 409 : 500 }
    );
  }

  if (hasFile) {
    const ext = evidence.type === "application/pdf" ? "pdf" : evidence.type.split("/")[1] ?? "bin";
    const path = `${user.id}/specialty/${inserted.id}.${ext}`;
    const bytes = new Uint8Array(await evidence.arrayBuffer());
    const { error: uploadError } = await serviceClient.storage
      .from("doctor-documents")
      .upload(path, bytes, { contentType: evidence.type, upsert: true });
    if (uploadError) {
      await serviceClient.from("doctor_specialty_changes").delete().eq("id", inserted.id);
      return NextResponse.json({ error: `Couldn't upload your file: ${uploadError.message}` }, { status: 502 });
    }
    const { error: pathError } = await serviceClient
      .from("doctor_specialty_changes")
      .update({ evidence_path: path })
      .eq("id", inserted.id);
    if (pathError) {
      await serviceClient.from("doctor_specialty_changes").delete().eq("id", inserted.id);
      return NextResponse.json({ error: pathError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
