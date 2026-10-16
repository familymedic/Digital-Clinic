import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkPin, getGuestStatus, hashPin } from "@/lib/guestAccess";

// Saves (or changes) the PIN a quick-booking guest will use, together with
// their mobile number, on "Find my appointment". Needs a live guest session:
// only the person already inside the booking can set it.

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
    return NextResponse.json({ error: "Your session isn't valid." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const pin = String(body?.pin ?? "");

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const status = await getGuestStatus(service, user.id);
  if (!status.ok) {
    return NextResponse.json({ error: "A PIN isn't needed for this account." }, { status: 409 });
  }

  const { data: access } = await service
    .from("guest_access")
    .select("phone_norm")
    .eq("account_id", user.id)
    .maybeSingle();
  const phoneNorm = (access as { phone_norm?: string } | null)?.phone_norm;
  if (!phoneNorm) {
    return NextResponse.json({ error: "A PIN isn't available for this account." }, { status: 409 });
  }

  const pinProblem = checkPin(pin, phoneNorm);
  if (pinProblem) return NextResponse.json({ error: pinProblem }, { status: 400 });

  const { error } = await service
    .from("guest_access")
    .update({ pin_hash: hashPin(pin), pin_set_at: new Date().toISOString() })
    .eq("account_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Couldn't save your PIN. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
