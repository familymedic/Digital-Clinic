import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Doctor onboarding, step 6 (2026-09-21): lets an admin view a doctor's
// uploaded subscription payment proof (bank transfer / JazzCash
// screenshot or PDF). Same shape as the existing CNIC/PMDC certificate
// viewer (src/app/api/admin/doctors/[id]/certificate/route.ts) and for
// the same reason: the "doctor-subscription-proofs" storage bucket
// (0044) is private with zero storage policies of its own for admin —
// a browser can't reach it directly no matter who's signed in — so
// this route is the only door in. Same caller's-own-token re-check
// pattern as every other privileged route in this app: verify the
// caller is a real admin via RLS before ever touching the service-role
// client.
//
// `id` here is the payment-proof row's own id, not a doctor id — a
// doctor can submit more than one proof over time (e.g. a rejected one
// followed by a corrected resubmission).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: proofId } = await params;

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

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: proofRow, error: proofError } = await serviceClient
    .from("doctor_subscription_payment_proofs")
    .select("file_path")
    .eq("id", proofId)
    .maybeSingle();

  if (proofError) {
    return NextResponse.json({ error: proofError.message }, { status: 500 });
  }
  if (!proofRow?.file_path) {
    return NextResponse.json({ error: "No payment proof found for this id." }, { status: 404 });
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from("doctor-subscription-proofs")
    .createSignedUrl(proofRow.file_path, 300); // 5 minutes — just long enough to view, not a permanent link

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signError?.message ?? "Couldn't generate a link to the proof file." },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
