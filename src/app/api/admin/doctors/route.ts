import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin system, step 2: "add a doctor." A doctor needs a real Supabase
// Auth account before doctor_profiles can reference it — today that
// happens by the physician manually asking someone to register, then
// running SQL. This route replaces both halves with one admin action:
// it invites the person by email (Supabase creates the auth.users row
// and emails them a link to set their own password — nobody's password
// ever passes through this app or Claude, satisfying Section 41 the
// same way registration already does for patients) and, once that
// succeeds, inserts their doctor_profiles row in the same request.
//
// Same authorization pattern as every other privileged route in this
// app (Daily.co room, payment): the caller's own token re-runs a real
// RLS-backed check — here, "does an admin_profiles row exist for this
// caller" — before the service-role client (which can invite users and
// bypasses RLS) is ever touched.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";

  if (!email || !fullName) {
    return NextResponse.json({ error: "A name and email are both required." }, { status: 400 });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // inviteUserByEmail creates the auth.users row (if one doesn't already
  // exist for this email) and sends Supabase's own invite email with a
  // link for the doctor to set their own password — the app and Claude
  // never see or set it. If this email is already registered (e.g. the
  // person already has a patient account), Supabase returns that
  // existing user rather than erroring, which is the right outcome here
  // too: the same account can be both a patient and a doctor.
  const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email);

  let doctorUserId: string | undefined = invited?.user?.id;

  if (inviteError) {
    // "already been registered" is the one expected non-fatal case —
    // look the existing account up instead of failing.
    if (/already/i.test(inviteError.message)) {
      const { data: existing, error: listError } = await serviceClient.auth.admin.listUsers();
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }
      const match = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!match) {
        return NextResponse.json(
          { error: "This email is already registered, but the matching account couldn't be found — please check the address." },
          { status: 500 }
        );
      }
      doctorUserId = match.id;
    } else {
      return NextResponse.json({ error: `Couldn't invite this doctor: ${inviteError.message}` }, { status: 502 });
    }
  }

  if (!doctorUserId) {
    return NextResponse.json({ error: "Couldn't determine the new doctor's account id." }, { status: 500 });
  }

  const { error: profileError } = await serviceClient
    .from("doctor_profiles")
    .upsert({ id: doctorUserId, full_name: fullName, is_active: true }, { onConflict: "id" });

  if (profileError) {
    return NextResponse.json({ error: `Invited, but couldn't save their profile: ${profileError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, doctorId: doctorUserId });
}
