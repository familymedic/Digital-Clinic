import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { PATIENT_TERMS_VERSION } from "@/lib/patientTerms";
import { QUICK_BOOKING_ENABLED } from "@/lib/quickBooking";
import { normalizePhone } from "@/lib/phone";
import { allowAttempt, clientIp, throttleKey } from "@/lib/guestAccess";
import { SITE_URL } from "@/lib/site";

// Quick booking: creates the patient's real (silent) account at the moment
// they enter their name and mobile number - right before payment. Same kind
// of account the existing guest flow (/api/guest/start) creates, with three
// differences: the mobile number is the identity (no email asked - a
// placeholder is used), the number is stored in a normalised form so the
// patient can find their appointment later, and account creation is rate
// limited. /api/guest/start itself is left exactly as it was.
//
// Every quick booking makes a NEW account, even if the same number was used
// before. Reusing an existing account just because someone typed its number
// would hand a stranger a session on someone else's records.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function placeholderEmail(): string {
  let host = "thefamilymedic.com";
  try {
    host = new URL(SITE_URL).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  return `guest.${crypto.randomBytes(12).toString("hex")}@${host}`;
}

export async function POST(request: NextRequest) {
  if (!QUICK_BOOKING_ENABLED) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const fullName = String(body.fullName ?? "").trim().replace(/\s+/g, " ");
  const phone = normalizePhone(body.phone);
  const agreedTerms = body.agreedTerms === true;

  if (fullName.length < 2 || fullName.length > 100) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Please enter a valid mobile number, for example 0300 1234567." },
      { status: 400 }
    );
  }
  if (!agreedTerms) {
    return NextResponse.json(
      { error: "Please agree to the Terms and Privacy Policy to continue." },
      { status: 400 }
    );
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Stops a script from creating accounts (and holding doctors' time slots)
  // in bulk. Generous for real use: a family on one phone or one shared
  // office connection is nowhere near these numbers.
  const okIp = await allowAttempt(service, throttleKey("gq-ip", clientIp(request)), 12, 3600);
  const okPhone = await allowAttempt(service, throttleKey("gq-ph", phone.norm), 6, 3600);
  if (!okIp || !okPhone) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a little while and try again, or call the clinic." },
      { status: 429 }
    );
  }

  const email = placeholderEmail();
  const password = crypto.randomBytes(24).toString("base64url");

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone: phone.display,
      is_guest: true,
      quick_booking: true,
      terms_version: PATIENT_TERMS_VERSION,
    },
  });

  if (createError || !created?.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Couldn't start your booking. Please try again." },
      { status: 502 }
    );
  }
  const userId = created.user.id;

  const { error: memberError } = await service
    .from("family_members")
    .update({ is_guest: true, guest_created_at: new Date().toISOString() })
    .eq("account_id", userId)
    .eq("relationship", "self");

  let setupError: string | null = memberError?.message ?? null;
  if (!setupError) {
    const { error: accessError } = await service
      .from("guest_access")
      .insert({ account_id: userId, phone_norm: phone.norm });
    setupError = accessError?.message ?? null;
  }

  if (setupError) {
    await service.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: `Couldn't start your booking: ${setupError}. Please try again.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ email, password });
}
