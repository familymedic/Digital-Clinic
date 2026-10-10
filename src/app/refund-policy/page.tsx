import Link from "next/link";
import PageHeader from "@/components/PageHeader";

// New page (2026-10-03), built to satisfy Safepay's KYC review, which
// requires a published refund/cancellation policy with a stated
// turnaround time, plus a public complaints-handling mechanism with a
// stated response-time commitment. Figures used here (7-14 business
// days for refunds, 2 business days for a complaint response) were
// explicit choices confirmed with the physician, not invented — see
// the go-live readiness checklist for that record. Reflects how
// refunds actually work in this app today: a manual, admin-decided
// process run through Safepay's own dashboard (0026/admin/refunds) —
// there is no self-service or automatic refund.
//
// Revised 2026-10-03 (physician): two additions confirmed directly by
// the physician, not invented. (1) A refund request must be submitted
// the same day as the affected consultation, by email with supporting
// evidence — the physician's own reasoning, recorded here because it
// affects how this reads: a cancelled or faulty consultation is
// something the patient already knows about immediately, unlike a
// slow-developing issue, so there's no reason to allow a days-long
// delay, and a written, evidence-backed request (not a phone/WhatsApp
// call) gives both the patient and Family Medic something concrete on
// record if Safepay or the patient later disputes the outcome — this
// is also exactly the kind of record the admin-only dispute-evidence
// PDF (see the go-live readiness checklist, Section 58) is built to
// produce. (2) A "When a refund will not be given" section, covering
// three exclusions the physician chose explicitly over a fourth
// option ("simple change of mind") that was offered and declined.
// (3) A "decision is final" line closing out the Refunds section,
// also explicitly requested by the physician.

const LAST_UPDATED = "October 3, 2026";

export default function RefundPolicy() {
  return (
    <div>
      <PageHeader
        title="Refund, Cancellation & Complaints Policy"
        subtitle={`Last updated: ${LAST_UPDATED}`}
      />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 text-sm leading-relaxed text-ink-700 sm:px-6 sm:text-base">
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-900">
            1. Cancelling a booking
          </h2>
          <p>
            If you need to cancel a booked consultation, contact us as soon
            as possible at{" "}
            <a href="mailto:contact@thefamilymedic.com" className="text-teal-700 underline">
              contact@thefamilymedic.com
            </a>{" "}
            or{" "}
            <a href="https://wa.me/923091340501" className="text-teal-700 underline">
              +92 309 1340501
            </a>{" "}
            (WhatsApp/call), including your booking details.
          </p>
          <p>
            Cancellations are reviewed and processed individually by our
            team; there is currently no automatic self-service
            cancellation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-900">2. Refunds</h2>
          <p>
            Because consultation fees are processed through our payment
            partner, <strong>Safepay</strong>, all refunds are reviewed
            individually by our team and, once approved, are processed
            through Safepay back to your original payment method.
          </p>
          <p>
            To request a refund, email{" "}
            <a href="mailto:contact@thefamilymedic.com" className="text-teal-700 underline">
              contact@thefamilymedic.com
            </a>{" "}
            on the same day as the affected consultation, describing what
            went wrong and attaching any supporting evidence (for example,
            a screenshot or a description of the technical issue). We
            review every refund request on its merits and process it once
            we&rsquo;ve confirmed the claim is genuine. Requests submitted
            after the same day, or without supporting evidence, may be
            declined on that basis alone.
          </p>
          <p>
            Approved refunds are typically completed within{" "}
            <strong>7–14 business days</strong> of approval. This reflects
            the time Safepay and your bank or wallet provider need to
            reverse a transaction, not additional delay on our side.
          </p>
          <p>
            A refund may be approved, for example, if a booked consultation
            could not take place due to a platform or doctor-side issue,
            you were charged in error, or your specific circumstances are
            reviewed and approved by our team on a case-by-case basis.
          </p>
          <p>
            Our decision on a refund request, once made, is final.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-900">
            3. When a refund will not be given
          </h2>
          <p>A refund will not be given where:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>the consultation was completed as booked;</li>
            <li>you did not join your scheduled consultation (a no-show); or</li>
            <li>
              the issue was caused by a problem with your own device,
              browser, or internet connection.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-900">
            4. No physical goods or shipping
          </h2>
          <p>
            Family Medic provides online medical consultations only —
            there is no physical product, shipping, or delivery involved.
            All consultations are delivered digitally, by text, audio, or
            video.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-900">
            5. Complaints handling
          </h2>
          <p>
            If something about your consultation or experience on Family
            Medic didn&rsquo;t meet your expectations, you can tell us in
            two ways: through the &ldquo;Leave feedback / report a
            problem&rdquo; option on your dashboard, or by contacting us
            directly using the details below.
          </p>
          <p>
            We aim to respond to every complaint within{" "}
            <strong>2 business days</strong>. More complex issues — for
            example, ones requiring a refund decision — may take a little
            longer to fully resolve, but you&rsquo;ll hear from us within
            that window.
          </p>
          <p>
            See our{" "}
            <Link href="/terms" className="text-teal-700 underline">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-teal-700 underline">
              Privacy Policy
            </Link>{" "}
            for the rest of how the Service works.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-[#d7e7e2] bg-[#f1f8f5] p-5">
          <h2 className="text-lg font-bold text-ink-900">6. Contact</h2>
          <p>The Family Medic, Karachi, Pakistan</p>
          <p>Online consultation service — no physical outlet for walk-in visits</p>
          <p>
            Email:{" "}
            <a href="mailto:contact@thefamilymedic.com" className="text-teal-700 underline">
              contact@thefamilymedic.com
            </a>
          </p>
          <p>
            WhatsApp / Call:{" "}
            <a href="https://wa.me/923091340501" className="text-teal-700 underline">
              +92 309 1340501
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
