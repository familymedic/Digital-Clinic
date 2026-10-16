import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGuestStatus, issueGuestSignIn, readAppointmentToken } from "@/lib/guestAccess";

// Opens a saved appointment link: checks the signed token, checks the
// guest's access window is still open, and hands back what the browser needs
// to sign in as that guest (an ordinary email + password sign-in), plus the
// page to land on.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EXPIRED = {
  error:
    "This link has expired or isn't valid any more. Use “Find my appointment” with your mobile number and PIN, or contact us.",
};

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const parsed = readAppointmentToken(String(body?.token ?? ""));
  if (!parsed) return NextResponse.json(EXPIRED, { status: 400 });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const status = await getGuestStatus(service, parsed.accountId);
  if (!status.ok || !status.email) {
    return NextResponse.json(EXPIRED, { status: 410 });
  }

  // The consultation must really belong to this account (the signature
  // already ties them together; this guards against a deleted record).
  const { data: consultation } = await service
    .from("consultations")
    .select("id, status, delivery_mode, patient:family_members!inner(account_id)")
    .eq("id", parsed.consultationId)
    .eq("patient.account_id", parsed.accountId)
    .maybeSingle();

  const row = consultation as { id: string; status: string; delivery_mode: "text" | "audio" | "video" } | null;
  let next = "/dashboard";
  if (row) {
    if (row.status === "pending_payment") next = `/consultation/${row.id}/payment`;
    else if (row.delivery_mode === "text") next = `/consultation/${row.id}/messages`;
    else next = `/consultation/${row.id}/call`;
  }

  const signIn = await issueGuestSignIn(service, parsed.accountId, status.email);
  if (!signIn) {
    return NextResponse.json({ error: "Couldn't open your appointment. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ...signIn, next });
}
