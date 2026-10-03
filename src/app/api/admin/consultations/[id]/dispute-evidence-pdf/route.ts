import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Admin-only "dispute evidence" PDF (2026-10-03, physician: "make it
// downloadable so i can share with the safepay or client if in
// dispute. see what is legally appropriate and build one please").
//
// What this is for: a factual, admin-generated summary of ONE
// consultation's booking/payment/cancellation/terms-acceptance record,
// to hand to Safepay or a patient if a refund decision is ever
// disputed. Deliberately NOT a clinical document — no complaint detail
// beyond the category already shown on the payment screen, no
// assessment, no prescription, nothing a patient's actual medical
// record would hold. That stays exactly where it already is (the
// doctor's clinical workspace / the patient's own prescription PDF),
// governed by its own access rules — this is a billing/compliance
// record, not a second copy of the chart.
//
// Same admin-only auth pattern as every other privileged admin route
// in this app (src/app/api/admin/doctors/[id]/certificate/route.ts):
// the caller's own Bearer token is re-checked against admin_profiles
// via RLS before any service-role access happens, rather than trusting
// a client-side admin check.
//
// Not legal advice, and says so on the document itself — see the
// footer disclaimer below. This summarizes what the database actually
// recorded; whether that's sufficient for a given dispute is a
// judgment call for the physician (and, if it comes to that, a real
// lawyer), not something this route decides.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
  delivery_mode: string;
  created_at: string;
  doctor_id: string | null;
  patient_id: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}

interface FamilyMemberRow {
  full_name: string;
  relationship: string;
  account_id: string;
}

interface SelfMemberRow {
  is_guest: boolean;
}

interface TermsAcceptanceRow {
  agreement_version: string;
  accepted_at: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  gateway: string;
  gateway_tracker_token: string | null;
  status: string;
  created_at: string;
  refunded_amount: number | null;
  refunded_at: string | null;
  refund_note: string | null;
}

interface DoctorRow {
  full_name: string;
  specialty: string | null;
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString()}`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const attempt = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(attempt, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: consultationId } = await context.params;

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
    .select("id, full_name")
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

  const { data: consultationData, error: consultationError } = await serviceClient
    .from("consultations")
    .select(
      "id, complaint, status, delivery_mode, created_at, doctor_id, patient_id, cancelled_at, cancelled_by, cancellation_reason"
    )
    .eq("id", consultationId)
    .maybeSingle();

  if (consultationError) {
    return NextResponse.json({ error: consultationError.message }, { status: 500 });
  }
  const consultation = consultationData as ConsultationRow | null;
  if (!consultation) {
    return NextResponse.json({ error: "Consultation not found." }, { status: 404 });
  }

  const { data: memberData, error: memberError } = await serviceClient
    .from("family_members")
    .select("full_name, relationship, account_id")
    .eq("id", consultation.patient_id)
    .maybeSingle();
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }
  const member = memberData as FamilyMemberRow | null;

  let accountEmail: string | null = null;
  let accountPhone: string | null = null;
  let isGuestAccount = false;
  let latestTermsAcceptance: TermsAcceptanceRow | null = null;
  if (member?.account_id) {
    const { data: authUser } = await serviceClient.auth.admin.getUserById(member.account_id);
    accountEmail = authUser?.user?.email ?? null;
    accountPhone =
      (authUser?.user?.user_metadata?.phone as string | undefined) ?? authUser?.user?.phone ?? null;

    // is_guest lives on the account's own 'self' family_members row
    // (0058_fix_guest_account_tracking.sql) — there is no separate
    // account-level profile table (patient_profiles does not exist;
    // confirmed directly against the live database, 2026-10-03).
    const { data: selfData } = await serviceClient
      .from("family_members")
      .select("is_guest")
      .eq("account_id", member.account_id)
      .eq("relationship", "self")
      .maybeSingle();
    isGuestAccount = (selfData as SelfMemberRow | null)?.is_guest ?? false;

    // Most recent terms acceptance on record for this account
    // (patient_agreement_acceptances, 0057). An account can only ever
    // accept the CURRENT version going forward, but shows every past
    // acceptance if the policy was ever re-accepted after a version
    // bump — only the latest is shown here since that's what governs
    // this consultation.
    const { data: termsData } = await serviceClient
      .from("patient_agreement_acceptances")
      .select("agreement_version, accepted_at")
      .eq("patient_account_id", member.account_id)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestTermsAcceptance = (termsData as TermsAcceptanceRow | null) ?? null;
  }

  let doctor: DoctorRow | null = null;
  if (consultation.doctor_id) {
    const { data: doctorData } = await serviceClient
      .from("doctor_profiles")
      .select("full_name, specialty")
      .eq("id", consultation.doctor_id)
      .maybeSingle();
    doctor = (doctorData as DoctorRow | null) ?? null;
  }

  const { data: paymentsData, error: paymentsError } = await serviceClient
    .from("payments")
    .select(
      "id, amount, currency, gateway, gateway_tracker_token, status, created_at, refunded_amount, refunded_at, refund_note"
    )
    .eq("consultation_id", consultationId)
    .order("created_at", { ascending: true });
  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 });
  }
  const payments = (paymentsData ?? []) as PaymentRow[];

  const cancelledByLabel =
    consultation.cancelled_by == null
      ? null
      : consultation.cancelled_by === consultation.doctor_id
        ? "the doctor"
        : "the patient (account holder)";

  // ---- Build the PDF ----
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 48;
  const contentWidth = width - margin * 2;

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  const teal = rgb(0.04, 0.32, 0.29);
  const tealLight = rgb(0.784, 0.929, 0.902);
  const ink900 = rgb(0.06, 0.09, 0.09);
  const ink500 = rgb(0.38, 0.43, 0.43);
  const amber = rgb(0.6, 0.38, 0.05);

  let y = height;

  function newPageIfNeeded(minSpace: number) {
    if (y < minSpace) {
      page = pdf.addPage([595.28, 841.89]);
      y = page.getHeight() - margin;
    }
  }

  function drawHeader(p: PDFPage, topY: number): number {
    const headerHeight = 74;
    p.drawRectangle({ x: 0, y: topY - headerHeight, width, height: headerHeight, color: teal });
    p.drawText("Family Medic", { x: margin, y: topY - 34, size: 22, font: bold, color: rgb(1, 1, 1) });
    p.drawText("Consultation & Payment Record — admin-generated", {
      x: margin,
      y: topY - 54,
      size: 10,
      font: regular,
      color: rgb(0.85, 0.95, 0.93),
    });
    return topY - headerHeight - 28;
  }

  y = drawHeader(page, y);

  page.drawText("Dispute Evidence Summary", { x: margin, y, size: 18, font: bold, color: ink900 });
  y -= 22;
  page.drawText(
    `Generated ${new Date().toLocaleString()} by ${adminRow.full_name} (admin) · Consultation ${consultation.id}`,
    { x: margin, y, size: 9, font: regular, color: ink500 }
  );
  y -= 22;

  function drawRule(p: PDFPage) {
    p.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.75,
      color: rgb(0.85, 0.87, 0.87),
    });
    y -= 16;
  }

  function drawSection(title: string, lines: string[]) {
    newPageIfNeeded(120);
    page.drawText(title, { x: margin, y, size: 12, font: bold, color: teal });
    y -= 16;
    for (const raw of lines) {
      for (const line of wrapText(raw, regular, 10, contentWidth)) {
        newPageIfNeeded(60);
        page.drawText(line, { x: margin, y, size: 10, font: regular, color: ink900 });
        y -= 14;
      }
    }
    y -= 10;
  }

  drawRule(page);

  drawSection("Patient / account", [
    `Name on booking: ${member?.full_name ?? "Unknown"}${member?.relationship ? ` (${member.relationship})` : ""}`,
    `Account email: ${accountEmail ?? "Unknown"}`,
    `Account phone: ${accountPhone ?? "Not provided"}`,
    `Account type: ${isGuestAccount ? "Guest (Quick Consult) checkout" : "Registered account"}`,
  ]);

  drawSection("Terms & Privacy Policy acceptance", [
    latestTermsAcceptance
      ? `Agreed on ${new Date(latestTermsAcceptance.accepted_at).toLocaleString()}, policy version "${latestTermsAcceptance.agreement_version}".`
      : "No terms-acceptance record exists for this account (it either predates this tracking being added, or the acceptance step was not completed through the current booking flow).",
  ]);

  drawSection("Booking", [
    `Complaint category: ${consultation.complaint}`,
    `Delivery mode: ${consultation.delivery_mode}`,
    `Booked: ${new Date(consultation.created_at).toLocaleString()}`,
    `Doctor: ${doctor ? `Dr. ${doctor.full_name}${doctor.specialty ? ` — ${doctor.specialty}` : ""}` : "Not yet assigned"}`,
    `Current status: ${consultation.status}`,
  ]);

  if (consultation.status === "cancelled") {
    drawSection("Cancellation", [
      consultation.cancelled_at ? `Cancelled: ${new Date(consultation.cancelled_at).toLocaleString()}` : "Cancelled (date not recorded)",
      `Cancelled by: ${cancelledByLabel ?? "Unknown"}`,
      `Reason given: ${consultation.cancellation_reason?.trim() || "None given"}`,
    ]);
  }

  newPageIfNeeded(140);
  page.drawText("Payment history", { x: margin, y, size: 12, font: bold, color: teal });
  y -= 16;
  if (payments.length === 0) {
    page.drawText("No payment attempts on record for this consultation.", {
      x: margin,
      y,
      size: 10,
      font: regular,
      color: ink900,
    });
    y -= 14;
  } else {
    for (const pmt of payments) {
      newPageIfNeeded(90);
      page.drawText(
        `${money(pmt.amount, pmt.currency)} via ${pmt.gateway} — ${pmt.status} — ${new Date(pmt.created_at).toLocaleString()}`,
        { x: margin, y, size: 10, font: bold, color: ink900 }
      );
      y -= 14;
      page.drawText(`Gateway reference: ${pmt.gateway_tracker_token ?? "Not recorded"}`, {
        x: margin + 12,
        y,
        size: 9.5,
        font: regular,
        color: ink500,
      });
      y -= 13;
      if (pmt.refunded_amount != null) {
        page.drawText(
          `Refunded ${money(pmt.refunded_amount, pmt.currency)} on ${pmt.refunded_at ? new Date(pmt.refunded_at).toLocaleString() : "unknown date"}${pmt.refund_note ? ` — ${pmt.refund_note}` : ""}`,
          { x: margin + 12, y, size: 9.5, font: regular, color: amber }
        );
        y -= 13;
      } else if (pmt.status === "succeeded") {
        page.drawText("No refund recorded for this payment.", {
          x: margin + 12,
          y,
          size: 9.5,
          font: regular,
          color: ink500,
        });
        y -= 13;
      }
      y -= 6;
    }
  }

  // Footer disclaimer on the last page.
  newPageIfNeeded(80);
  page.drawRectangle({ x: 0, y: 0, width, height: 64, color: tealLight });
  page.drawText(
    "This is a factual summary of records held in Family Medic's own systems as of the date above.",
    { x: margin, y: 38, size: 8.5, font: regular, color: teal }
  );
  page.drawText(
    "It is provided to support a payment or service dispute and is not legal advice. Clinical/consultation",
    { x: margin, y: 24, size: 8.5, font: regular, color: teal }
  );
  page.drawText("content is deliberately excluded.", { x: margin, y: 10, size: 8.5, font: bold, color: teal });

  const pdfBytes = await pdf.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="family-medic-dispute-evidence-${consultationId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
