import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";

// A doctor saves their own mobile number (0079). It is private: shown only to the
// doctor and to the clinic's admins, never to patients. Written here with the
// service-role key to the CALLER'S OWN row only, the same pattern as
// /api/doctors/profile (doctor_profiles has no doctor-facing UPDATE policy).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    return NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  const parsed = normalizePhone(body?.phone);
  if (!parsed) {
    return NextResponse.json(
      { error: "Please enter a valid mobile number, for example 0300 1234567." },
      { status: 400 }
    );
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: updated, error } = await serviceClient
    .from("doctor_profiles")
    .update({ phone: parsed.norm })
    .eq("id", user.id)
    .select("id");
  if (error) {
    return NextResponse.json({ error: "Couldn't save your number. Please try again in a minute." }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Only doctor accounts can save a contact number." }, { status: 403 });
  }
  return NextResponse.json({ success: true, display: parsed.display });
}
