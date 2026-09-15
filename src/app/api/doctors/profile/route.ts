import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Doctor public profile submission (2026-09-15). A doctor's own bio,
// years of experience, and photo are written here — through a
// service-role route that only ever touches the CALLER'S OWN row — and
// never through a direct client UPDATE, because doctor_profiles still
// has zero doctor-facing RLS UPDATE policies (by design, see 0034's own
// comment). This route re-verifies the caller's token itself, the same
// pattern as every other privileged route in this app (certificate
// view, payment, Daily.co room); a doctor can never submit a profile
// for anyone but themselves, and only ever lands as profile_status =
// 'pending_review' regardless of what the form sends — an admin's
// approval (a plain RLS UPDATE they already have full access for) is
// what actually makes it public, via the public_doctor_directory view.
//
// A CNIC (national ID) scan + number is required the first time a
// doctor submits a profile, if they don't already have one on file —
// confirmed with the physician as an extra identity check on top of the
// PMDC certificate already collected at registration (0027). Once a
// CNIC is on file, a resubmission (e.g. updating a bio after a
// rejection, or just refreshing a photo) doesn't ask for it again.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB, matching the PMDC certificate limit
const ALLOWED_DOC_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BIO_LENGTH = 1000;

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

  // Only a live, approved doctor can submit a public profile — an
  // applicant still pending PMDC review, or a rejected/deactivated one,
  // has nothing to show patients yet.
  const { data: doctorRow, error: doctorError } = await serviceClient
    .from("doctor_profiles")
    .select("verification_status, is_active, cnic_certificate_path, profile_photo_url")
    .eq("id", user.id)
    .maybeSingle();

  if (doctorError) {
    return NextResponse.json({ error: doctorError.message }, { status: 500 });
  }
  if (!doctorRow || doctorRow.verification_status !== "approved" || !doctorRow.is_active) {
    return NextResponse.json(
      { error: "Only an approved, active doctor account can submit a public profile." },
      { status: 403 }
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const bio = String(form.get("bio") ?? "").trim();
  const yearsRaw = String(form.get("yearsOfExperience") ?? "").trim();
  const cnicNumber = String(form.get("cnicNumber") ?? "").trim();
  const photo = form.get("photo");
  const cnicCertificate = form.get("cnicCertificate");

  if (bio.length < 20) {
    return NextResponse.json(
      { error: "Please write a short bio (at least 20 characters) so patients know a bit about you." },
      { status: 400 }
    );
  }
  if (bio.length > MAX_BIO_LENGTH) {
    return NextResponse.json({ error: `Please keep your bio under ${MAX_BIO_LENGTH} characters.` }, { status: 400 });
  }
  const years = Number(yearsRaw);
  if (!Number.isFinite(years) || years < 0 || !Number.isInteger(years)) {
    return NextResponse.json({ error: "Please enter your years of experience as a whole number." }, { status: 400 });
  }

  const hasCnicOnFile = !!doctorRow.cnic_certificate_path;
  if (!hasCnicOnFile) {
    if (cnicNumber.length < 5) {
      return NextResponse.json({ error: "Please enter your CNIC number." }, { status: 400 });
    }
    if (!(cnicCertificate instanceof File) || cnicCertificate.size === 0) {
      return NextResponse.json({ error: "Please attach a scanned copy of your CNIC." }, { status: 400 });
    }
    if (cnicCertificate.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "The CNIC file is too large (max 8MB)." }, { status: 400 });
    }
    if (!ALLOWED_DOC_TYPES.includes(cnicCertificate.type)) {
      return NextResponse.json({ error: "The CNIC scan must be a JPG, PNG, WEBP, or PDF file." }, { status: 400 });
    }
  }

  let photoUrl = doctorRow.profile_photo_url; // keep the existing photo unless a new one is uploaded
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "The photo is too large (max 8MB)." }, { status: 400 });
    }
    if (!ALLOWED_PHOTO_TYPES.includes(photo.type)) {
      return NextResponse.json({ error: "The photo must be a JPG, PNG, or WEBP file." }, { status: 400 });
    }
    const extension = photo.type.split("/")[1] ?? "jpg";
    const photoPath = `${user.id}/photo.${extension}`;
    const photoBytes = new Uint8Array(await photo.arrayBuffer());
    const { error: photoUploadError } = await serviceClient.storage
      .from("doctor-photos")
      .upload(photoPath, photoBytes, { contentType: photo.type, upsert: true });
    if (photoUploadError) {
      return NextResponse.json({ error: `Couldn't upload your photo: ${photoUploadError.message}` }, { status: 502 });
    }
    photoUrl = serviceClient.storage.from("doctor-photos").getPublicUrl(photoPath).data.publicUrl;
  }

  let cnicCertificatePath = doctorRow.cnic_certificate_path;
  if (!hasCnicOnFile && cnicCertificate instanceof File) {
    const extension = cnicCertificate.type === "application/pdf" ? "pdf" : cnicCertificate.type.split("/")[1] ?? "bin";
    cnicCertificatePath = `${user.id}/cnic.${extension}`;
    const cnicBytes = new Uint8Array(await cnicCertificate.arrayBuffer());
    const { error: cnicUploadError } = await serviceClient.storage
      .from("doctor-documents")
      .upload(cnicCertificatePath, cnicBytes, { contentType: cnicCertificate.type, upsert: true });
    if (cnicUploadError) {
      return NextResponse.json({ error: `Couldn't upload your CNIC: ${cnicUploadError.message}` }, { status: 502 });
    }
  }

  const { error: updateError } = await serviceClient
    .from("doctor_profiles")
    .update({
      bio,
      years_of_experience: years,
      profile_photo_url: photoUrl,
      cnic_number: hasCnicOnFile ? undefined : cnicNumber,
      cnic_certificate_path: cnicCertificatePath,
      profile_status: "pending_review",
      profile_rejection_reason: null,
    })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
