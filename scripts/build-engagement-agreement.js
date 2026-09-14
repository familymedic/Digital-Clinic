const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  AlignmentType,
  PageBreak,
  Numbering,
  LevelFormat,
} = require("docx");

const PAGE_WIDTH = 12240; // US Letter, DXA
const PAGE_HEIGHT = 15840;

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } });
}

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 160 },
  });
}

function bullet(text) {
  return new Paragraph({
    text,
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
  });
}

function noticeBox(lines) {
  return new Table({
    width: { size: 9350, type: WidthType.DXA },
    columnWidths: [9350],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9350, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "FDF3E3" },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            children: lines.map(
              (line, i) =>
                new Paragraph({
                  children: [new TextRun({ text: line, bold: i === 0, size: 20 })],
                  spacing: { after: i === lines.length - 1 ? 0 : 80 },
                })
            ),
          }),
        ],
      }),
    ],
  });
}

function feeTierTable() {
  const header = (text) =>
    new TableCell({
      shading: { type: ShadingType.CLEAR, fill: "0A3733" },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })] })],
    });
  const cell = (text, bold = false) =>
    new TableCell({
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
    });
  const colWidths = [3117, 3117, 3116];
  return new Table({
    width: { size: 9350, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        children: [header("Consultation Fee (PKR)"), header("Platform Share (PKR)"), header("Physician Share")],
      }),
      new TableRow({ children: [cell("500 – 900"), cell("150"), cell("Fee minus platform share")] }),
      new TableRow({ children: [cell("901 – 1,200"), cell("200"), cell("Fee minus platform share")] }),
      new TableRow({ children: [cell("1,201 – 1,500"), cell("250"), cell("Fee minus platform share")] }),
      new TableRow({
        children: [
          cell("Above 1,500", true),
          cell("Set case-by-case", true),
          cell("Requires separate admin approval before this fee goes live", true),
        ],
      }),
    ],
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT }],
      },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT } } },
      children: [
        new Paragraph({
          children: [new TextRun({ text: "PHYSICIAN ENGAGEMENT AGREEMENT", bold: true, size: 34 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "Family Medic — Digital Family Clinic", size: 24, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        noticeBox([
          "DRAFT — FOR PHYSICIAN REVIEW ONLY. NOT LEGAL ADVICE.",
          "This is a first draft prepared by Claude at Dr. Zayn's request, for his own review — the same way clinical consent wording has always worked on this project. It has not been reviewed by a lawyer and must not be sent to any doctor for signature in its current form.",
          "Every bracketed item [ like this ] is a placeholder Dr. Zayn needs to fill in or decide, and every item marked “(Recommend lawyer review)” is a clause with real legal consequences that a licensed Pakistani lawyer should check before this is used — particularly Sections 12 (regulatory compliance), 14 (termination), and 16 (liability).",
          "This draft was written using the business terms Dr. Zayn already confirmed in this project (fee tiers, minimum fee, subscription fee) plus the regulatory findings from this project's own 2026-09 business audit — it does not reflect new legal research beyond that.",
        ]),

        new Paragraph({ children: [new PageBreak()] }),

        h1("1. Parties"),
        p(
          "This Agreement is made between [Family Medic / Digital Family Clinic — legal business name and registration details to be inserted] (“the Platform”) and [Doctor's full name], holder of PMDC registration number [PMDC number] (“the Physician”), collectively “the Parties.”"
        ),

        h1("2. Background"),
        p(
          "The Platform operates an online service through which patients can book and pay for medical consultations with independent, PMDC-verified physicians, delivered by video, audio, or text. The Platform provides the booking, payment, and record-keeping technology; it does not provide medical advice, diagnosis, or treatment itself, and does not employ the Physician. The Physician wishes to offer consultations to patients through the Platform on the terms below."
        ),

        h1("3. Term"),
        p(
          "This Agreement begins on the date of the Physician's approval by the Platform's administrator and continues until terminated by either Party under Section 14. [Insert any fixed initial term or renewal cycle, if wanted, e.g. “renews annually unless terminated.”]"
        ),

        h1("4. Independent Contractor Status"),
        p(
          "The Physician provides consultations as an independent contractor, not as an employee, agent, or partner of the Platform. The Physician is responsible for their own income tax, professional licensing fees, and any staff or equipment they use. Nothing in this Agreement creates an employment relationship or entitles the Physician to any employee benefit."
        ),
        p(
          "[Decide: is the Physician free to also practice/consult through other platforms or in their own clinic at the same time? The recommended default is yes, with no exclusivity, unless Dr. Zayn wants otherwise — see Section 13.]"
        ),

        h1("5. Professional Credentials and Verification"),
        bullet("The Physician represents that they hold a current, valid PMDC registration under number [PMDC number], and that the certificate submitted at registration is genuine and unaltered."),
        bullet("The Physician must notify the Platform in writing within [e.g. 3 business days] if their PMDC registration is suspended, revoked, lapses, or becomes subject to any disciplinary proceeding."),
        bullet("The Platform may suspend the Physician's access immediately, without prior notice, if it has reasonable grounds to believe the Physician's registration is no longer valid (Section 14)."),

        h1("6. Scope of Services"),
        p(
          "The Physician will provide medical consultations to patients booked through the Platform, by the delivery method the patient selects (video, audio, or text), within the specialty/department the Physician registered under: [Specialty]. The Physician sets their own consultation fee, subject to Section 7, and may update it from time to time through the Platform, subject to the same approval rules applying to any new fee."
        ),

        h1("7. Consultation Fees and Platform Share"),
        p(
          "The Physician's consultation fee must be at least PKR 500. The Platform's share of each consultation fee is set by the fee actually charged, as follows:"
        ),
        feeTierTable(),
        new Paragraph({ spacing: { before: 160 } }),
        p(
          "A fee above PKR 1,500 requires the Platform administrator's separate, explicit approval before it may be charged to any patient; the exact platform share for such a fee is set by the administrator at approval time and confirmed to the Physician in writing before it takes effect."
        ),
        p(
          "A consultation the Physician waives (e.g. a free follow-up) earns the Physician their full share as if the standard fee had been charged — the Platform absorbs that visit's cost, not the Physician. A refunded consultation earns the Physician nothing for that visit."
        ),

        h1("8. Platform Subscription Fee"),
        p(
          "The Physician pays the Platform a subscription fee of PKR 5,000 per month to remain listed and able to accept bookings. [Billing mechanism to be confirmed — this project is still testing whether Pakistani payment gateways support real automatic recurring billing; until confirmed, this fee will be collected by [manual bank transfer / other method] and recorded by the administrator each month.] Non-payment of this fee for [e.g. 30 days] is grounds for suspension under Section 14."
        ),

        h1("9. Payment Settlement"),
        p(
          "The Physician's share of consultation fees (Section 7) is settled monthly, based on consultations that reached a completed status during that period, less any refunded consultations. Payout amounts are generated by the administrator and paid by [bank transfer / other method] to the account the Physician provides. The Physician can view their own payout history through their dashboard."
        ),

        h1("10. Clinical Responsibility"),
        bullet("The Physician is solely and fully responsible for every clinical decision made for a patient consulted through the Platform — diagnosis, treatment, prescriptions, and any advice given."),
        bullet("The Platform's technology (including any guided-history questionnaire) is assistive only. It never makes a diagnosis, never issues a prescription, and never substitutes for the Physician's own independent clinical judgment."),
        bullet("The Physician is responsible for judging, for each individual patient, whether a remote consultation (video, audio, or text) is clinically appropriate at all, and for directing the patient to in-person or emergency care whenever it is not — including, without limitation, any presentation of chest pain, shortness of breath, or another emergency warning sign, regardless of what the patient selected when booking."),
        bullet("The Physician maintains their own clinical records in line with PMDC's professional requirements, in addition to what is recorded on the Platform."),

        h1("11. Confidentiality and Patient Data"),
        p(
          "The Physician will keep all patient information encountered through the Platform confidential, consistent with ordinary physician-patient confidentiality obligations, and will not use it for any purpose outside providing the consultation itself. The Physician will not download, copy, or export patient data from the Platform except as reasonably needed for their own clinical recordkeeping. [Note for lawyer review: Pakistan currently has no enacted general data-protection law (confirmed by this project's own 2026 research) — this clause is based on ordinary professional confidentiality duties, not a specific statute; a lawyer should confirm this is adequate.]"
        ),

        h1("12. Professional Conduct and Regulatory Compliance (Recommend lawyer review)"),
        bullet("The Physician will comply with all PMDC codes of conduct and any law applicable to their practice, including any telemedicine-specific registration or training requirement that may apply — for example, the Sindh Telemedicine and Telehealth Act, 2021 has been reported (though not independently confirmed by this project against the primary legal text) to require practitioner registration before offering telehealth to patients located in Sindh. [This entire point needs direct confirmation from a Sindh-based lawyer or the Sindh Health Department before this Agreement is finalized, per this project's own prior audit finding.]"),
        bullet("[Optional, recommended: require the Physician to maintain their own professional indemnity / malpractice insurance for the term of this Agreement, and to provide proof on request. Decide whether to make this mandatory.]"),
        bullet("The Physician will not prescribe any medication outside what PMDC and applicable law permit to be prescribed via a remote consultation."),

        h1("13. Non-Solicitation and Exclusivity"),
        p(
          "[Optional clause — decide whether to include. Example: “The Physician will not, during the term of this Agreement, solicit a patient met through the Platform to consult with them directly outside the Platform for the same condition.” Consider fairness/enforceability and whether this fits how the Platform actually wants to grow its doctor network before including it.]"
        ),

        h1("14. Suspension and Termination"),
        p("The Platform may suspend or deactivate the Physician's account, with or without prior notice depending on severity, for any of the following:"),
        bullet("The Physician's PMDC registration lapses, is suspended, or is revoked."),
        bullet("Non-payment of the monthly subscription fee for [e.g. 30 days]."),
        bullet("A pattern of patient complaints or safety events, at the administrator's reasonable discretion."),
        bullet("Any breach of this Agreement, PMDC's code of conduct, or applicable law."),
        p(
          "Either Party may otherwise terminate this Agreement for any reason with [e.g. 30 days'] written notice. On termination, the Physician's final payout is settled for all consultations completed before the termination date."
        ),

        h1("15. Intellectual Property and Branding"),
        p(
          "The Platform's name, logo, and branding remain the Platform's property. The Physician may not use them outside the Platform without written permission. Any content the Platform provides the Physician for use on their profile remains the Platform's property."
        ),

        h1("16. Limitation of Liability (Recommend lawyer review)"),
        p(
          "[This section needs a lawyer's drafting, not Claude's. It should address: the Platform's role as a technology/booking intermediary rather than a healthcare provider; that the Physician carries their own professional/malpractice liability for clinical decisions; and any cap or exclusion of the Platform's liability to the Physician for indirect or consequential loss. Do not use a generic template clause here without a lawyer's review — this is the section most likely to matter if something goes wrong.]"
        ),

        h1("17. Dispute Resolution and Governing Law"),
        p(
          "[Decide: governing law (likely the law of Pakistan, and the province where the Platform is legally based or registered) and how disputes are resolved — direct negotiation first, then courts of [city/province], or arbitration. A lawyer should confirm the right forum.]"
        ),

        h1("18. Amendment"),
        p(
          "The Platform may update the fee tiers in Section 7, the subscription fee in Section 8, or other operational terms from time to time, with [e.g. 30 days'] written notice to the Physician before the change takes effect. Continuing to accept new bookings after that date is treated as acceptance of the updated terms."
        ),

        h1("19. Entire Agreement"),
        p(
          "This Agreement, together with any Platform policy it refers to, is the entire agreement between the Parties regarding the Physician's engagement and supersedes any earlier discussion or understanding on the same subject."
        ),

        h1("20. Signatures"),
        new Paragraph({ spacing: { before: 300, after: 300 } }),
        p("For the Platform:", { bold: true }),
        p("Name: _______________________________          Date: _______________"),
        p("Signature: ___________________________"),
        new Paragraph({ spacing: { before: 300, after: 300 } }),
        p("For the Physician:", { bold: true }),
        p("Name: _______________________________          Date: _______________"),
        p("PMDC #: _____________________________"),
        p("Signature: ___________________________"),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  require("fs").writeFileSync("/home/claude/family-med-platform/docs/legal/physician-engagement-agreement-DRAFT.docx", buffer);
  console.log("written");
});
