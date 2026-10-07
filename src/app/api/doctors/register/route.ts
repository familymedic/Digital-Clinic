import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SPECIALTIES } from "@/lib/specialties";
import { MIN_DOCTOR_CONSULTATION_FEE } from "@/lib/platformFee";
import { ENGAGEMENT_AGREEMENT_VERSION } from "@/lib/engagementAgreement";
import { recordEvent } from "@/lib/serverTelemetry";

// Doctor onboarding, step 1: public self-registration. Unlike the
// existing admin-invite route (src/app/api/admin/doctors/route.ts),
// nobody needs to be signed in to call this — a doctor is applying to
// join, not being added by staff. Everything is done server-side with
// the service-role client (account creation, certificate upload, and
// the doctor_profiles insert) rather than three separate client calls,
// so there's one place enforcing that a new application always lands as
// verification_status='pending_review' / is_active=false, regardless of
// what the form sends — the same "never trust the client for anything
// that gates access" principle used throughout this app.
//
// A new application is invisible everywhere until an admin approves it
// (src/app/admin/doctors/page.tsx) — this route does not, and cannot,
// make anyone bookable or able to see the doctor dashboard.

// Site-health (2026-10-07): give this route room to finish (account +
// certificate upload + two inserts) instead of being cut off mid-way on a
// slow connection, which could leave a half-created account behind.
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 4MB: the hosting platform rejects request bodies over ~4.5MB before this code
// even runs, so a higher limit here could never be reached. The form shrinks photos first.
const MAX_CERTIFICATE_BYTES = 4 * 1024 * 1024;
const ALLOWED_CERTIFICATE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const fullName = String(form.get("fullName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const specialty = String(form.get("specialty") ?? "").trim();
  const pmdcNumber = String(form.get("pmdcNumber") ?? "").trim();
  const requestedFeeRaw = String(form.get("consultationFee") ?? "").trim();
  const certificate = form.get("certificate");
  // Only the boolean gate is trusted from the client — the version
  // actually recorded is always this server's own current constant,
  // never whatever the client's form happened to send, so an acceptance
  // record can never claim a version this server didn't actually show.
  const agreementAccepted = String(form.get("agreementAccepted") ?? "") === "true";

  if (fullName.length < 2) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!SPECIALTIES.includes(specialty as (typeof SPECIALTIES)[number])) {
    return NextResponse.json({ error: "Please choose a valid specialty." }, { status: 400 });
  }
  if (pmdcNumber.length < 3) {
    return NextResponse.json({ error: "Please enter your PMDC registration number." }, { status: 400 });
  }
  const requestedFee = Number(requestedFeeRaw);
  if (!Number.isFinite(requestedFee) || requestedFee < MIN_DOCTOR_CONSULTATION_FEE) {
    return NextResponse.json(
      { error: `Your consultation fee must be at least PKR ${MIN_DOCTOR_CONSULTATION_FEE}.` },
      { status: 400 }
    );
  }
  if (!(certificate instanceof File) || certificate.size === 0) {
    return NextResponse.json({ error: "Please attach your scanned PMDC certificate." }, { status: 400 });
  }
  if (certificate.size > MAX_CERTIFICATE_BYTES) {
    return NextResponse.json({ error: "The certificate file is too large (max 4MB). Photos are shrunk automatically on the form; if this is a PDF, please upload a smaller one." }, { status: 400 });
  }
  if (!ALLOWED_CERTIFICATE_TYPES.includes(certificate.type)) {
    return NextResponse.json(
      { error: "The certificate must be a JPG, PNG, WEBP, or PDF file." },
      { status: 400 }
    );
  }
  if (!agreementAccepted) {
    return NextResponse.json(
      { error: "You must agree to the Physician Engagement Agreement to apply." },
      { status: 400 }
    );
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create the account. Unlike the admin-invite flow, the applicant sets
  // their own password directly, so this uses createUser rather than
  // inviteUserByEmail — email_confirm: true lets them log in right away
  // (harmless: doctor login itself now also checks approval status, see
  // src/lib/doctor.ts, so an unapproved applicant who logs in still sees
  // nothing but "your application is under review").
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    if (createError && /already.*registered|already exists/i.test(createError.message)) {
      return NextResponse.json(
        {
          error:
            "This email is already registered. If this is your existing account, please contact us so we can add doctor access to it — applying fresh here won't work for an email that's already in use.",
        },
        { status: 409 }
      );
    }
    await recordEvent(
      serviceClient,
      { source: "server", kind: "server_error", label: "/api/doctors/register", message: "account creation failed" + (((createError) as { code?: string } | null)?.code ? ` (${((createError) as { code?: string }).code})` : "") },
      request.nextUrl.origin
    );
    return NextResponse.json(
      { error: createError?.message ?? "Couldn't create your account." },
      { status: 502 }
    );
  }

  const userId = created.user.id;

  // Upload the certificate before inserting the profile row, so we never
  // end up with a doctor_profiles row pointing at a file that doesn't
  // exist. If anything below fails, we clean up the auth account we just
  // created rather than leaving an orphaned, half-registered account the
  // applicant can't do anything with and can't re-register with either
  // (their email would already be taken).
  const extension = certificate.type === "application/pdf" ? "pdf" : certificate.type.split("/")[1] ?? "bin";
  const certificatePath = `${userId}/pmdc-certificate.${extension}`;
  const certificateBytes = new Uint8Array(await certificate.arrayBuffer());

  const { error: uploadError } = await serviceClient.storage
    .from("doctor-documents")
    .upload(certificatePath, certificateBytes, { contentType: certificate.type, upsert: true });

  if (uploadError) {
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    await recordEvent(
      serviceClient,
      { source: "server", kind: "server_error", label: "/api/doctors/register", message: "certificate upload failed" + (((uploadError) as { code?: string } | null)?.code ? ` (${((uploadError) as { code?: string }).code})` : "") },
      request.nextUrl.origin
    );
    return NextResponse.json(
      { error: `Couldn't upload your certificate: ${uploadError.message}. Please try again.` },
      { status: 502 }
    );
  }

  const { error: profileError } = await serviceClient.from("doctor_profiles").insert({
    id: userId,
    full_name: fullName,
    email,
    specialty,
    pmdc_number: pmdcNumber,
    pmdc_certificate_path: certificatePath,
    consultation_fee: Math.round(requestedFee),
    verification_status: "pending_review",
    fee_status: "not_set",
    is_active: false,
  });

  if (profileError) {
    await serviceClient.storage.from("doctor-documents").remove([certificatePath]).catch(() => {});
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    await recordEvent(
      serviceClient,
      { source: "server", kind: "server_error", label: "/api/doctors/register", message: "profile insert failed" + (((profileError) as { code?: string } | null)?.code ? ` (${((profileError) as { code?: string }).code})` : "") },
      request.nextUrl.origin
    );
    return NextResponse.json(
      { error: `Couldn't save your application: ${profileError.message}. Please try again.` },
      { status: 502 }
    );
  }

  // The actual "protect ourselves" record (2026-09-26): an immutable,
  // timestamped proof of exactly which version of the Physician
  // Engagement Agreement this application accepted, and when — see
  // 0047_doctor_agreement_acceptance.sql. An application that made it
  // this far but couldn't have its acceptance recorded is rolled back
  // completely, the same as every other failure above: an application
  // without a recorded acceptance would defeat the entire point of
  // asking for one.
  const { error: agreementError } = await serviceClient.from("doctor_agreement_acceptances").insert({
    doctor_id: userId,
    agreement_version: ENGAGEMENT_AGREEMENT_VERSION,
  });

  if (agreementError) {
    await serviceClient
      .from("doctor_profiles")
      .delete()
      .eq("id", userId)
      .then(
        () => {},
        () => {}
      );
    await serviceClient.storage.from("doctor-documents").remove([certificatePath]).catch(() => {});
    await serviceClient.auth.admin.deleteUser(userId).catch(() => {});
    await recordEvent(
      serviceClient,
      { source: "server", kind: "server_error", label: "/api/doctors/register", message: "agreement insert failed" + (((agreementError) as { code?: string } | null)?.code ? ` (${((agreementError) as { code?: string }).code})` : "") },
      request.nextUrl.origin
    );
    return NextResponse.json(
      { error: `Couldn't record your agreement acceptance: ${agreementError.message}. Please try again.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
