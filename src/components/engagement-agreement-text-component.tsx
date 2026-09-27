import { ENGAGEMENT_AGREEMENT_TEXT, ENGAGEMENT_AGREEMENT_NOTICE } from "@/lib/engagementAgreement";

// Shared renderer for the engagement agreement's plain text (see
// src/lib/engagementAgreement.ts) — used on /doctor/register (before
// acceptance) and DoctorShell's agreement gate (for an already-approved
// doctor who hasn't accepted the current version yet). One component so
// the two places can never drift into showing subtly different text.
//
// The source text splits sections with a blank line and starts each
// section with "<number>. <Heading>" — this just detects that pattern
// to bold the heading line, rather than needing any markup in the
// source string itself.

const HEADING_RE = /^\d+\.\s/;

export default function EngagementAgreementText() {
  const paragraphs = ENGAGEMENT_AGREEMENT_TEXT.split("\n\n");

  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
      <p className="mb-3 rounded-md bg-amber-50 p-2.5 text-[11px] font-medium text-amber-800">
        {ENGAGEMENT_AGREEMENT_NOTICE}
      </p>
      {paragraphs.map((para, i) => {
        const lines = para.split("\n");
        const isHeading = HEADING_RE.test(lines[0]);
        return (
          <p key={i} className="mb-3">
            {isHeading ? (
              <>
                <span className="block font-bold text-slate-900">{lines[0]}</span>
                {lines.slice(1).join(" ")}
              </>
            ) : (
              para
            )}
          </p>
        );
      })}
    </div>
  );
}
