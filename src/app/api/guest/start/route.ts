import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Guest "quick consult" account creation (2026-09-30, physician: "is
// there a passage where we can offer patients to consult without
// registering for those who dont want to register?"). Deliberately NOT
// full anonymity — see 0050_guest_patient_accounts.sql's own comment
// for why — this creates a REAL account, the same kind /register
// creates, just without asking the patient to consciously go through a
// signup screen or choose a password themselves. Everything downstream
// (RLS, booking, payment) is then the exact same code path a registered
// patient already uses; nothing new to trust there.
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

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // A real password, just never shown to the patient and never stored
  // anywhere after this one request — used once, client-side, in the
  // same response cycle, purely to establish a real session.
  const password = crypto.randomBytes(24).toString("base64url");

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: phone || null, is_guest: true },
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

  // The on_auth_user_created trigger (0001_patient_profiles.sql) already
  // inserted a patient_profiles row using the full_name/phone in the
  // metadata above — this just marks that row as a guest account and
  // starts its 15-day clock (0050_guest_patient_accounts.sql).
  const { error: profileError } = await serviceClient
    .from("patient_profiles")
    .update({ is_guest: true, guest_created_at: new Date().toISOString() })
    .eq("id", userId);

  if (profileError) {
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: `Couldn't start your consultation: ${profileError.message}. Please try again.` },
      { status: 502 }
    );
  }

  // A "self" family member so the patient can go straight to booking —
  // no separate "add a family member" step first, for their own
  // consultation.
  const { error: memberError } = await serviceClient.from("family_members").insert({
    account_id: userId,
    full_name: fullName,
    relationship: "self",
  });

  if (memberError) {
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: `Couldn't start your consultation: ${memberError.message}. Please try again.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ email, password });
}
