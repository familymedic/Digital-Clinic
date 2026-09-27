import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Patient-facing branded PDF of an issued prescription (2026-09-27,
// physician: "would the patient be able to download the prescription in
// PDF mentioning the doctor and family medic branding on the top"). The
// on-screen prescription view (src/app/consultation/[id]/prescription)
// used to say plainly "A downloadable copy (PDF) isn't available yet" —
// this route is that missing piece.
//
// Same authorization pattern as every other patient-scoped route in this
// app (src/app/api/consultations/[id]/room, .../payment): the caller's
// own access token re-runs the exact RLS-backed SELECTs the on-screen
// view already relies on, so there is no separate access-control logic
// to get wrong, and — just as important — RLS (0018) only ever returns
// an assessment/medications row here once a doctor has Approved &
// Issued it, the same "a draft is structurally invisible to the
// patient" guarantee the on-screen view already depends on.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface ConsultationRow {
  complaint: string;
  doctor_id: string | null;
  patient: { full_name: string } | { full_name: string }[] | null;
}

interface AssessmentRow {
  assessment: string | null;
  advice: string | null;
  referral: string | null;
  follow_up_date: string | null;
  follow_up_reason: string | null;
  issued_at: string | null;
}

interface MedicationRow {
  medication_name: string;
  dosage: string | null;
  instructions: string | null;
}

interface DoctorRow {
  full_name: string;
  specialty: string | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// Wraps `text` to fit within `maxWidth` at the given font/size, returning
// one array entry per line. Deliberately simple (word-by-word, no
// hyphenation) — this is a clinical note, not typeset copy, and every
// existing field it renders (assessment/advice/referral) is already
// short free text entered by a doctor through a plain <textarea>.
function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
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

  const [consultationRes, assessmentRes, medsRes] = await Promise.all([
    userClient
      .from("consultations")
      .select("complaint, doctor_id, patient:family_members(full_name)")
      .eq("id", consultationId)
      .maybeSingle(),
    userClient
      .from("consultation_assessments")
      .select("assessment, advice, referral, follow_up_date, follow_up_reason, issued_at")
      .eq("consultation_id", consultationId)
      .maybeSingle(),
    userClient
      .from("consultation_medications")
      .select("medication_name, dosage, instructions")
      .eq("consultation_id", consultationId)
      .order("position", { ascending: true }),
  ]);

  if (consultationRes.error) {
    return NextResponse.json({ error: consultationRes.error.message }, { status: 500 });
  }
  const consultation = consultationRes.data as ConsultationRow | null;
  if (!consultation) {
    return NextResponse.json({ error: "This consultation isn't available to you." }, { status: 404 });
  }

  if (assessmentRes.error) {
    return NextResponse.json({ error: assessmentRes.error.message }, { status: 500 });
  }
  const assessment = assessmentRes.data as AssessmentRow | null;
  if (!assessment) {
    return NextResponse.json({ error: "Nothing has been issued for this consultation yet." }, { status: 404 });
  }

  const medications = (medsRes.data ?? []) as MedicationRow[];

  let doctor: DoctorRow | null = null;
  if (consultation.doctor_id) {
    const { data: doctorData } = await userClient
      .from("public_doctor_directory")
      .select("full_name, specialty")
      .eq("id", consultation.doctor_id)
      .maybeSingle();
    doctor = (doctorData as DoctorRow | null) ?? null;
  }

  const patient = one(consultation.patient);

  // ---- Build the PDF ----
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width } = page.getSize();
  const margin = 48;
  const contentWidth = width - margin * 2;

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  const teal = rgb(0.04, 0.32, 0.29); // matches the site's brand-950-ish header tone
  const tealLight = rgb(0.784, 0.929, 0.902); // matches the site's mint background
  const ink900 = rgb(0.06, 0.09, 0.09);
  const ink500 = rgb(0.38, 0.43, 0.43);

  let y = page.getHeight();

  // Header band — brand name + tagline, so a printed/downloaded copy is
  // identifiable as coming from Family Medic even on its own, away from
  // the site.
  const headerHeight = 74;
  page.drawRectangle({ x: 0, y: y - headerHeight, width, height: headerHeight, color: teal });
  page.drawText("Family Medic", {
    x: margin,
    y: y - 34,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Digital Family Clinic · thefamilymedic.com", {
    x: margin,
    y: y - 54,
    size: 10,
    font: regular,
    color: rgb(0.85, 0.95, 0.93),
  });
  y -= headerHeight + 28;

  page.drawText("Prescription", { x: margin, y, size: 18, font: bold, color: ink900 });
  y -= 26;

  const metaLines: string[] = [];
  if (doctor) {
    metaLines.push(`Prescribed by: Dr. ${doctor.full_name}${doctor.specialty ? ` — ${doctor.specialty}` : ""}`);
  } else {
    metaLines.push("Prescribed by: a Family Medic physician");
  }
  if (patient) metaLines.push(`For: ${patient.full_name}`);
  metaLines.push(`Consultation: ${consultation.complaint}`);
  if (assessment.issued_at) {
    metaLines.push(`Issued: ${new Date(assessment.issued_at).toLocaleString()}`);
  }

  for (const line of metaLines) {
    page.drawText(line, { x: margin, y, size: 11, font: regular, color: ink900 });
    y -= 16;
  }
  y -= 10;

  function drawRule() {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.75,
      color: rgb(0.85, 0.87, 0.87),
    });
    y -= 16;
  }

  function drawSection(title: string, body: string) {
    if (y < 90) return; // A real multi-page layout is a later refinement — every field here is short free text today.
    page.drawText(title, { x: margin, y, size: 12, font: bold, color: teal });
    y -= 16;
    for (const line of wrapText(body, regular, 10.5, contentWidth)) {
      page.drawText(line, { x: margin, y, size: 10.5, font: regular, color: ink900 });
      y -= 14;
    }
    y -= 8;
  }

  drawRule();

  if (assessment.assessment) drawSection("Assessment", assessment.assessment);

  if (medications.length > 0) {
    page.drawText("Prescription", { x: margin, y, size: 12, font: bold, color: teal });
    y -= 16;
    for (const m of medications) {
      const line = `•  ${m.medication_name}${m.dosage ? ` — ${m.dosage}` : ""}`;
      for (const l of wrapText(line, regular, 10.5, contentWidth)) {
        page.drawText(l, { x: margin, y, size: 10.5, font: regular, color: ink900 });
        y -= 14;
      }
      if (m.instructions) {
        for (const l of wrapText(m.instructions, regular, 9.5, contentWidth - 14)) {
          page.drawText(l, { x: margin + 14, y, size: 9.5, font: regular, color: ink500 });
          y -= 13;
        }
      }
      y -= 4;
    }
    y -= 8;
  }

  if (assessment.advice) drawSection("Advice", assessment.advice);
  if (assessment.referral) drawSection("Referral", assessment.referral);
  if (assessment.follow_up_date || assessment.follow_up_reason) {
    const followUp = [
      assessment.follow_up_date ? new Date(assessment.follow_up_date).toLocaleDateString() : "",
      assessment.follow_up_reason ?? "",
    ]
      .filter(Boolean)
      .join(" — ");
    drawSection("Follow-up", followUp);
  }

  // Footer disclaimer — same "clinical decisions are always the
  // doctor's, never automated" framing already used elsewhere on the
  // site (e.g. the homepage trust section), so this reads consistently
  // wherever a patient encounters it. A second line makes clear this
  // downloadable copy is a treatment record only, not a document meant
  // to be relied on as legal evidence (physician's own request,
  // 2026-09-27: "add not valid for court of law somewhere in the
  // prescription pad so it is not misused in legal matters").
  page.drawRectangle({ x: 0, y: 0, width, height: 56, color: tealLight });
  page.drawText(
    "Issued electronically via Family Medic. Clinical decisions are always made by the treating physician.",
    { x: margin, y: 30, size: 8.5, font: regular, color: teal }
  );
  page.drawText(
    "This is a medical treatment record only and is not valid for use as a legal or court document.",
    { x: margin, y: 16, size: 8.5, font: bold, color: teal }
  );

  const pdfBytes = await pdf.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="family-medic-prescription-${consultationId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
