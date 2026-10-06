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
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  // Fix (2026-10-06): the built-in PDF fonts can only print Latin
  // characters. Any other script (for example Urdu in Arabic script)
  // used to make pdf-lib throw halfway through, so the patient got a
  // generic server error and no explanation. Check everything up front
  // and say plainly what is wrong instead. (Roman Urdu is plain Latin
  // and prints fine.)
  const allText: string[] = [
    assessment.assessment ?? "",
    assessment.advice ?? "",
    assessment.referral ?? "",
    assessment.follow_up_reason ?? "",
    consultation.complaint ?? "",
    patient?.full_name ?? "",
    doctor?.full_name ?? "",
    doctor?.specialty ?? "",
    ...medications.flatMap((m) => [m.medication_name ?? "", m.dosage ?? "", m.instructions ?? ""]),
  ];
  for (const t of allText) {
    try {
      regular.encodeText(t.replace(/\r?\n/g, " "));
    } catch {
      return NextResponse.json(
        {
          error:
            "This prescription contains characters (for example Urdu script) that the PDF can't print yet. You can still read it on this page, and your doctor can re-issue it in English or Roman Urdu if you need a PDF.",
        },
        { status: 422 }
      );
    }
  }

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const margin = 48;
  const contentWidth = PAGE_W - margin * 2;
  const FOOTER_H = 56;
  const BOTTOM = FOOTER_H + 24; // content never goes below this line

  const teal = rgb(0.04, 0.32, 0.29); // matches the site's brand-950-ish header tone
  const tealLight = rgb(0.784, 0.929, 0.902); // matches the site's mint background
  const ink900 = rgb(0.06, 0.09, 0.09);
  const ink500 = rgb(0.38, 0.43, 0.43);

  // Multi-page layout (2026-10-06): the first version was one fixed page
  // and silently dropped anything that didn't fit (long advice, many
  // medicines). Every line now goes through ensureSpace(), which starts
  // a new page when needed, so nothing is ever cut off.
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 34, width: PAGE_W, height: 34, color: teal });
    page.drawText("Family Medic  ·  Prescription (continued)", {
      x: margin,
      y: PAGE_H - 22,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y = PAGE_H - 34 - 28;
  }

  function ensureSpace(h: number) {
    if (y - h < BOTTOM) newPage();
  }

  // Pakistan time, regardless of where the server runs (Vercel runs in
  // UTC, which printed the issue time 5 hours behind).
  function pkt(dateIso: string): string {
    return (
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Karachi",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(dateIso)) + " PKT"
    );
  }
  function dateOnly(d: string): string {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
      new Date(d)
    );
  }

  // Header band — brand name + tagline, so a printed/downloaded copy is
  // identifiable as coming from Family Medic even on its own, away from
  // the site.
  const headerHeight = 74;
  page.drawRectangle({ x: 0, y: y - headerHeight, width: PAGE_W, height: headerHeight, color: teal });
  page.drawText("Family Medic", { x: margin, y: y - 34, size: 22, font: bold, color: rgb(1, 1, 1) });
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
  if (assessment.issued_at) metaLines.push(`Issued: ${pkt(assessment.issued_at)}`);

  for (const line of metaLines) {
    for (const l of wrapText(line, regular, 11, contentWidth)) {
      ensureSpace(16);
      page.drawText(l, { x: margin, y, size: 11, font: regular, color: ink900 });
      y -= 16;
    }
  }
  y -= 10;

  ensureSpace(20);
  page.drawLine({
    start: { x: margin, y },
    end: { x: PAGE_W - margin, y },
    thickness: 0.75,
    color: rgb(0.85, 0.87, 0.87),
  });
  y -= 16;

  function drawTitle(title: string) {
    ensureSpace(16 + 14 * 2); // title + at least two lines, so a title is never stranded at the bottom
    page.drawText(title, { x: margin, y, size: 12, font: bold, color: teal });
    y -= 16;
  }

  function drawSection(title: string, body: string) {
    drawTitle(title);
    for (const line of wrapText(body, regular, 10.5, contentWidth)) {
      ensureSpace(14);
      page.drawText(line, { x: margin, y, size: 10.5, font: regular, color: ink900 });
      y -= 14;
    }
    y -= 8;
  }

  if (assessment.assessment) drawSection("Assessment", assessment.assessment);

  if (medications.length > 0) {
    drawTitle("Prescription");
    for (const m of medications) {
      const line = `•  ${m.medication_name}${m.dosage ? ` — ${m.dosage}` : ""}`;
      const instr = m.instructions ? wrapText(m.instructions, regular, 9.5, contentWidth - 14) : [];
      // keep a medicine and its first instruction line together
      ensureSpace(14 + (instr.length > 0 ? 13 : 0));
      for (const l of wrapText(line, regular, 10.5, contentWidth)) {
        ensureSpace(14);
        page.drawText(l, { x: margin, y, size: 10.5, font: regular, color: ink900 });
        y -= 14;
      }
      for (const l of instr) {
        ensureSpace(13);
        page.drawText(l, { x: margin + 14, y, size: 9.5, font: regular, color: ink500 });
        y -= 13;
      }
      y -= 4;
    }
    y -= 8;
  }

  if (assessment.advice) drawSection("Advice", assessment.advice);
  if (assessment.referral) drawSection("Referral", assessment.referral);
  if (assessment.follow_up_date || assessment.follow_up_reason) {
    const followUp = [assessment.follow_up_date ? dateOnly(assessment.follow_up_date) : "", assessment.follow_up_reason ?? ""]
      .filter(Boolean)
      .join(" — ");
    drawSection("Follow-up", followUp);
  }

  // Footer on EVERY page. Disclaimer wording unchanged: clinical
  // decisions are always the treating physician's, and (physician's own
  // request, 2026-09-27) the copy is a treatment record only, not valid
  // as a legal or court document.
  const pages = pdf.getPages();
  pages.forEach((pg, idx) => {
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: tealLight });
    pg.drawText(
      "Issued electronically via Family Medic. Clinical decisions are always made by the treating physician.",
      { x: margin, y: 30, size: 8.5, font: regular, color: teal }
    );
    pg.drawText("This is a medical treatment record only and is not valid for use as a legal or court document.", {
      x: margin,
      y: 16,
      size: 8.5,
      font: bold,
      color: teal,
    });
    if (pages.length > 1) {
      const label = `Page ${idx + 1} of ${pages.length}`;
      pg.drawText(label, {
        x: PAGE_W - margin - regular.widthOfTextAtSize(label, 8.5),
        y: 16,
        size: 8.5,
        font: regular,
        color: teal,
      });
    }
  });

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
