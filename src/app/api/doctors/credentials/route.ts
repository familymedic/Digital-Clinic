import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { credentialOption, checkOtherName, matchListedCode, DETAIL_MAX } from "@/lib/credentials";

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

  // One request can carry SEVERAL credentials (2026-10-11): `items` is a JSON
  // list of { code, detail }, plus an optional "Other" credential typed by the
  // doctor (other_name / other_detail). The older single-credential fields
  // (credential / detail) still work, so nothing that already sends them breaks.
  interface Item {
    code: string;
    detail: string;
    needsEvidence: boolean;
  }
  const items: Item[] = [];
  const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });

  let rawItems: unknown[] = [];
  const itemsField = form.get("items");
  if (typeof itemsField === "string" && itemsField.trim()) {
    try {
      const parsed = JSON.parse(itemsField);
      if (!Array.isArray(parsed)) return bad("Couldn't read your selection.");
      rawItems = parsed;
    } catch {
      return bad("Couldn't read your selection.");
    }
  } else {
    const legacyCode = String(form.get("credential") ?? "").trim();
    if (legacyCode) rawItems = [{ code: legacyCode, detail: String(form.get("detail") ?? "") }];
  }
  if (rawItems.length > 12) return bad("Please send at most 12 credentials in one request.");

  for (const raw of rawItems) {
    const r = raw as { code?: unknown; detail?: unknown };
    const code = typeof r?.code === "string" ? r.code.trim() : "";
    const detail = typeof r?.detail === "string" ? r.detail.trim() : "";
    const option = credentialOption(code);
    if (!option) return bad("Please choose credentials from the list.");
    if (detail.length > DETAIL_MAX) return bad(`Please keep each subject under ${DETAIL_MAX} characters.`);
    items.push({ code: option.code, detail, needsEvidence: option.needsEvidence });
  }

  const otherNameRaw = String(form.get("other_name") ?? "").trim();
  const otherDetail = String(form.get("other_detail") ?? "").trim();
  if (otherNameRaw) {
    const checked = checkOtherName(otherNameRaw);
    if (checked.name === null) return bad(checked.error);
    if (otherDetail.length > DETAIL_MAX) return bad(`Please keep "awarded by" under ${DETAIL_MAX} characters.`);
    // Typing a listed code (e.g. "fcps") is treated as that listed credential,
    // and "Other" credentials ALWAYS need proof.
    const listed = matchListedCode(checked.name);
    items.push({ code: listed ?? checked.name, detail: otherDetail, needsEvidence: true });
  }

  if (items.length === 0) return bad("Please choose at least one credential.");

  // Same credential twice in one request → keep one.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = `${i.code.toLowerCase()}|${i.detail.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const evidence = form.get("evidence");
  const hasFile = evidence instanceof File && evidence.size > 0;
  const needProof = unique.filter((i) => i.needsEvidence);
  if (needProof.length > 0 && !hasFile) {
    return bad(
      `${needProof.map((i) => i.code).join(", ")} ${needProof.length > 1 ? "need" : "needs"} proof. Please attach your certificate (from CPSP or the awarding body), or your PMDC registration showing the qualification.`
    );
  }
  if (hasFile) {
    if (evidence.size > MAX_FILE_BYTES) {
      return bad("The file is too large (max 4MB). Please upload a smaller scan or photo.");
    }
    if (!ALLOWED_TYPES.includes(evidence.type)) {
      return bad("The file must be a JPG, PNG, WEBP, or PDF.");
    }
  }

  // Skip anything already requested / approved (same name + subject).
  const { data: existing, error: existingError } = await serviceClient
    .from("doctor_credentials")
    .select("credential, detail")
    .eq("doctor_id", user.id)
    .in("status", ["pending_review", "approved"]);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const have = new Set((existing ?? []).map((r) => `${String(r.credential).toLowerCase()}|${String(r.detail ?? "").toLowerCase()}`));
  const fresh = unique.filter((i) => !have.has(`${i.code.toLowerCase()}|${i.detail.toLowerCase()}`));
  const skipped = unique.filter((i) => have.has(`${i.code.toLowerCase()}|${i.detail.toLowerCase()}`));
  const skippedLabels = skipped.map((i) => `${i.code}${i.detail ? ` (${i.detail})` : ""}`);
  if (fresh.length === 0) {
    return NextResponse.json(
      { error: `You already have ${skippedLabels.join(", ")} approved or waiting for review.` },
      { status: 409 }
    );
  }

  // One insert for all of them — either every request is saved or none is.
  const { data: inserted, error: insertError } = await serviceClient
    .from("doctor_credentials")
    .insert(
      fresh.map((i) => ({
        doctor_id: user.id,
        credential: i.code,
        detail: i.detail || null,
        status: "pending_review",
      }))
    )
    .select("id, credential, detail");
  if (insertError || !inserted || inserted.length === 0) {
    return NextResponse.json({ error: insertError?.message ?? "Couldn't save your request." }, { status: 500 });
  }
  const insertedIds = inserted.map((r) => r.id as string);

  // The proof file is stored once and linked to every credential that needs it.
  if (hasFile) {
    const needing = inserted.filter((r) =>
      fresh.some((i) => i.needsEvidence && i.code === r.credential && (i.detail || null) === (r.detail ?? null))
    );
    if (needing.length > 0) {
      const ext = evidence.type === "application/pdf" ? "pdf" : evidence.type.split("/")[1] ?? "bin";
      const path = `${user.id}/credentials/${needing[0].id}.${ext}`;
      const bytes = new Uint8Array(await evidence.arrayBuffer());
      const { error: uploadError } = await serviceClient.storage
        .from("doctor-documents")
        .upload(path, bytes, { contentType: evidence.type, upsert: true });
      if (uploadError) {
        // Don't leave requests that can't be reviewed.
        await serviceClient.from("doctor_credentials").delete().in("id", insertedIds);
        return NextResponse.json({ error: `Couldn't upload your file: ${uploadError.message}` }, { status: 502 });
      }
      const { error: pathError } = await serviceClient
        .from("doctor_credentials")
        .update({ evidence_path: path })
        .in("id", needing.map((r) => r.id as string));
      if (pathError) {
        await serviceClient.from("doctor_credentials").delete().in("id", insertedIds);
        return NextResponse.json({ error: pathError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true, created: inserted.length, skipped: skippedLabels });

}
