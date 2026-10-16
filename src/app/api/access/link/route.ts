import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGuestStatus, makeAppointmentToken } from "@/lib/guestAccess";
import { formatPhone } from "@/lib/phone";
import { SITE_URL } from "@/lib/site";

// Gives a signed-in quick-booking guest the saved link for one of their own
// appointments, plus what the "save your access" panel needs to show.
//
// Authorization is the same trick the payment and room routes use: the
// caller's own token re-runs the normal RLS-protected read of the
// consultation, so a guest can only ever get a link to their own booking.

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

  const body = await request.json().catch(() => null);
  const consultationId = String(body?.consultationId ?? "");
  if (!consultationId) return NextResponse.json({ error: "Missing consultation." }, { status: 400 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid." }, { status: 401 });
  }

  const { data: consultation } = await userClient
    .from("consultations")
    .select("id, doctor_id, scheduled_slot:doctor_availability_slots(start_time)")
    .eq("id", consultationId)
    .maybeSingle();
  if (!consultation) {
    return NextResponse.json({ error: "This consultation isn't available to you." }, { status: 404 });
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const status = await getGuestStatus(service, user.id);
  if (!status.ok) {
    return NextResponse.json({ error: "A saved link isn't available for this account." }, { status: 409 });
  }

  const appointmentToken = makeAppointmentToken(user.id, consultationId);
  if (!appointmentToken) {
    return NextResponse.json({ error: "Couldn't create the link." }, { status: 500 });
  }

  const { data: access } = await service
    .from("guest_access")
    .select("phone_norm, pin_hash")
    .eq("account_id", user.id)
    .maybeSingle();
  const accessRow = access as { phone_norm: string; pin_hash: string | null } | null;
  if (!accessRow) {
    return NextResponse.json({ error: "A saved link isn't available for this account." }, { status: 409 });
  }

  let doctorName: string | null = null;
  const doctorId = (consultation as { doctor_id: string | null }).doctor_id;
  if (doctorId) {
    const { data: doc } = await service
      .from("public_doctor_directory")
      .select("full_name")
      .eq("id", doctorId)
      .maybeSingle();
    doctorName = (doc as { full_name?: string } | null)?.full_name ?? null;
  }

  const slot = (consultation as { scheduled_slot?: { start_time: string } | { start_time: string }[] | null })
    .scheduled_slot;
  const when = (Array.isArray(slot) ? slot[0]?.start_time : slot?.start_time) ?? null;

  return NextResponse.json({
    url: `${SITE_URL}/a/${appointmentToken}`,
    accessUntil: status.accessUntil?.toISOString() ?? null,
    pinSet: !!accessRow.pin_hash,
    phoneNorm: accessRow.phone_norm,
    phoneDisplay: formatPhone(accessRow.phone_norm),
    doctorName,
    when,
  });
}
