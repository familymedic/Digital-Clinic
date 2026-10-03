import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { PATIENT_TERMS_VERSION } from "@/lib/patientTerms";

// Guest "quick consult" account creation (2026-09-30, physician: "is
// there a passage where we can offer patients to consult without
// registering for those who dont want to register?"). Deliberately NOT
// full anonymity — see 0058_fix_guest_account_tracking.sql's own
// comment for why — this creates a REAL account, the same kind
// /register creates, just without asking the patient to consciously go
// through a signup screen or choose a password themselves. Everything
// downstream (RLS, booking, payment) is then the exact same code path a
// registered patient already uses; nothing new to trust there.
//
// Fixed 2026-10-03: this originally targeted a `patient_profiles` table
// that was never actually live (see 0058's comment for the full story)
// — every real guest-checkout attempt before this fix would have
// failed. Now targets `family_members` instead, which does exist.
//
// The random password generated here is returned to the caller exactly
// once, over HTTPS, so the browser can sign the patient in immediately
// with it (supabase.auth.signInWithPassword, see GuestQuickStart.tsx)
// — it is never logged and never stored anywhere by this route itself,
// and the patient never has to see or remember it. Getting back in
// later (or choosing to keep this account permanently by setting a
// real password) both go through the site's existing /forgot-password
// -> /reset-password flow, the same as any other patient.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s-]{6,}$/;

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const fullName = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const agreedTerms = body.agreedTerms === true;

  if (fullName.length < 2) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (phone && !PHONE_RE.test(phone)) {
    return NextResponse.json(
      { error: "Please enter a valid phone number, or leave this blank." },
      { status: 400 }
    );
  }
  // Re-checked server-side (2026-10-03) — the checkbox in
  // GuestQuickStart.tsx is just UI; this is what actually makes an
  // un-agreed submission impossible, the same way /register's own
  // server-side-trusted signUp call depends on the trigger reading
  // terms metadata rather than trusting the client's validation alone.
  if (!agreedTerms) {
    return NextResponse.json(
      { error: "Please agree to the Terms and Privacy Policy to continue." },
      { status: 400 }
    );
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // A real password, just never shown to the patient and never stored
  // anywhere after this one request — used once, client-side, in the
  // same response cycle, purely to establish a real session.
  const password = crypto.randomBytes(24).toString("base64url");

  // terms_version in metadata is picked up by the new
  // record_patient_terms_acceptance() trigger (0057) and written to
  // patient_agreement_acceptances automatically — same mechanism the
  // normal /register signUp() call below now uses, so this route
  // doesn't need to touch that table directly at all.
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone: phone || null,
      is_guest: true,
      terms_version: PATIENT_TERMS_VERSION,
    },
  });

  if (createError || !created?.user) {
    if (createError && /already.*registered|already exists/i.test(createError.message)) {
      return NextResponse.json(
        {
          error:
            "This email already has an account. Please log in instead — you don't need Quick Consult.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: createError?.message ?? "Couldn't start your consultation. Please try again." },
      { status: 502 }
    );
  }

  const userId = created.user.id;

  // Fixed 2026-10-03 — this used to update a `patient_profiles` row and
  // separately INSERT a new 'self' family_members row, on the mistaken
  // assumption (copied from the original, never-actually-applied
  // 0050_guest_patient_accounts.sql) that patient_profiles exists. It
  // doesn't — confirmed directly against the live database — which
  // meant every real guest-checkout attempt failed right here. It was
  // also creating a SECOND, redundant 'self' family member on top of
  // the one the signup trigger (handle_new_account_self_member, 0003)
  // already creates from the full_name in the metadata above. This now
  // just UPDATEs that already-existing self row, on family_members
  // (0058_fix_guest_account_tracking.sql), to mark it as a guest and
  // start its 15-day clock.
  const { error: memberError } = await serviceClient
    .from("family_members")
    .update({ is_guest: true, guest_created_at: new Date().toISOString() })
    .eq("account_id", userId)
    .eq("relationship", "self");

  if (memberError) {
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: `Couldn't start your consultation: ${memberError.message}. Please try again.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ email, password });
}
