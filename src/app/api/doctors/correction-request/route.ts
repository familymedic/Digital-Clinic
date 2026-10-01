import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MIN_DOCTOR_CONSULTATION_FEE } from "@/lib/platformFee";

// Doctor correction requests for name/consultation fee (2026-09-30/
// 10-01, physician: "can a doctor request correction in name and fee.
// if yes i havent seen any option"). Same shape as the existing profile
// submission route (src/app/api/doctors/profile): a doctor never writes
// full_name or consultation_fee directly -- doctor_profiles still has
// zero doctor-facing RLS UPDATE policy at all -- they submit a
// REQUESTED value here, through a service-role route that only ever
// touches the CALLER'S OWN row, and it only actually goes live once an
// admin approves it from /admin/doctors (a plain RLS update, since
// admin already has full write access).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

export async function POST(request: NextRequest) {
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

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "This needs the Supabase service-role key configured on the server first." },
      { status: 503 }
    );
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Same gate as the profile-submission route: only a live, approved
  // doctor account can request anything here.
  const { data: doctorRow, error: doctorError } = await serviceClient
    .from("doctor_profiles")
    .select("verification_status, is_active, correction_status")
    .eq("id", user.id)
    .maybeSingle();

  if (doctorError) {
    return NextResponse.json({ error: doctorError.message }, { status: 500 });
  }
  if (!doctorRow || doctorRow.verification_status !== "approved" || !doctorRow.is_active) {
    return NextResponse.json(
      { error: "Only an approved, active doctor account can request a correction." },
      { status: 403 }
    );
  }
  if (doctorRow.correction_status === "pending") {
    return NextResponse.json(
      { error: "You already have a correction request awaiting review — please wait for that one to be resolved first." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Couldn't read the submitted request." }, { status: 400 });
  }

  const requestedFullNameRaw = typeof body.requestedFullName === "string" ? body.requestedFullName.trim() : "";
  const requestedFeeRaw = body.requestedConsultationFee;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const wantsNameChange = requestedFullNameRaw.length > 0;
  const wantsFeeChange = requestedFeeRaw !== null && requestedFeeRaw !== undefined && requestedFeeRaw !== "";

  if (!wantsNameChange && !wantsFeeChange) {
    return NextResponse.json(
      { error: "Please enter a new name and/or a new fee — at least one is needed to submit a request." },
      { status: 400 }
    );
  }
  if (wantsNameChange && requestedFullNameRaw.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `Please keep the name under ${MAX_NAME_LENGTH} characters.` }, { status: 400 });
  }

  let requestedFee: number | null = null;
  if (wantsFeeChange) {
    requestedFee = Number(requestedFeeRaw);
    if (!Number.isFinite(requestedFee) || !Number.isInteger(requestedFee)) {
      return NextResponse.json({ error: "Please enter the requested fee as a whole number." }, { status: 400 });
    }
    if (requestedFee < MIN_DOCTOR_CONSULTATION_FEE) {
      return NextResponse.json(
        { error: `The consultation fee can't be set below PKR ${MIN_DOCTOR_CONSULTATION_FEE}.` },
        { status: 400 }
      );
    }
  }

  if (reason.length < 10) {
    return NextResponse.json(
      { error: "Please briefly explain why you're requesting this change (at least 10 characters) so the admin can review it." },
      { status: 400 }
    );
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `Please keep your reason under ${MAX_REASON_LENGTH} characters.` }, { status: 400 });
  }

  const { error: updateError } = await serviceClient
    .from("doctor_profiles")
    .update({
      requested_full_name: wantsNameChange ? requestedFullNameRaw : null,
      requested_consultation_fee: wantsFeeChange ? requestedFee : null,
      correction_reason: reason,
      correction_status: "pending",
      correction_rejection_reason: null,
      correction_requested_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
