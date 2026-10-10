import { ENGAGEMENT_AGREEMENT_TEXT } from "@/lib/engagementAgreement";

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
    <div className="max-h-80 overflow-y-auto rounded-lg border border-[#d7e7e2] bg-[#f1f8f5] p-4 text-xs leading-relaxed text-ink-700">
      {paragraphs.map((para: string, i: number) => {
        const lines = para.split("\n");
        const isHeading = HEADING_RE.test(lines[0]);
        return (
          <p key={i} className="mb-3">
            {isHeading ? (
              <>
                <span className="block font-bold text-ink-900">{lines[0]}</span>
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
