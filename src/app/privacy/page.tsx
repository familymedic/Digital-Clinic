import PageHeader from "@/components/PageHeader";

// Real Privacy Policy, replacing the "Draft placeholder" text that was
// live here before (flagged by Safepay's KYC review, 2026-10-03).
// Revised 2026-10-03 at the physician's request: removed the formal
// "we/us/our" defined-terms convention from the introduction (not
// legally required, just a common legal-drafting habit — dropped for
// plainer language), and removed the paragraph noting that no
// Pakistani data-protection law is currently in force, per the
// physician's explicit instruction not to include it. The policy
// still makes no claim of compliance with any specific law — it simply
// no longer raises the topic at all.

const LAST_UPDATED = "October 3, 2026";

export default function Privacy() {
  return (
    <div>
      <PageHeader
        title="Privacy Policy"
        subtitle={`Last updated: ${LAST_UPDATED}`}
      />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 text-sm leading-relaxed text-slate-700 sm:px-6 sm:text-base">
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">1. Introduction</h2>
          <p>
            This Privacy Policy explains how The Family Medic, which
            operates thefamilymedic.com, collects, uses, and protects your
            personal and health information when you use our telemedicine
            platform.
          </p>
          <p>
            By using our Services, you agree to this Privacy Policy. Because
            you may be sharing sensitive health information with us, we
            want to be especially clear about what we collect and why.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            2. Information we collect
          </h2>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>Account information:</strong> name, email, phone
              number, and password (never stored in plain text) — and, for
              doctors, PMDC license number and certificate, CNIC, and bank
              details for payouts.
            </li>
            <li>
              <strong>Health information:</strong> symptoms, medical
              history, and anything else you or your family member share
              with your doctor before or during a consultation, plus the
              consultation record itself (notes, assessment, and any
              prescription your doctor issues).
            </li>
            <li>
              <strong>Family member profiles:</strong> information about
              family members you add to your account to book consultations
              on their behalf.
            </li>
            <li>
              <strong>Payment information:</strong> we never see or store
              your card or wallet number — this is handled entirely by our
              payment processor, Safepay. We retain only the consultation
              amount, status, and transaction reference needed for your
              records and ours.
            </li>
            <li>
              <strong>Technical information:</strong> basic page-visit
              analytics (which pages are viewed, when), collected directly
              by our own systems. We do not use third-party advertising
              trackers.
            </li>
            <li>
              <strong>Push notification data:</strong> if you opt in to
              notifications, we store the technical subscription details
              your browser provides (not your name or message content) so
              we can send you an alert.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            3. How we use your information
          </h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              To provide the consultation you booked and let your doctor
              review your relevant history.
            </li>
            <li>To process payment through Safepay and confirm your booking.</li>
            <li>
              To send you booking confirmations, appointment reminders, and
              status updates — by email and, if you opt in, push
              notification.
            </li>
            <li>To respond to questions or complaints you send us.</li>
            <li>
              To maintain the security and proper functioning of the
              platform, and to meet our own legal, tax (FBR), and financial
              record-keeping obligations.
            </li>
          </ul>
          <p>
            We do not sell your personal or health information to anyone,
            and we do not use it for third-party advertising.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            4. Who we share it with
          </h2>
          <p>Your attending physician, for the consultation you book with them. Beyond that, a small number of service providers who help us run the platform, each only to the extent needed for their function:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><strong>Safepay</strong> — payment processing.</li>
            <li>
              <strong>Supabase</strong> — our database and secure file
              storage.
            </li>
            <li>
              <strong>Daily.co</strong> — video/audio consultation calls.
              Calls are not recorded by us.
            </li>
            <li><strong>Resend</strong> — sending transactional emails.</li>
            <li><strong>Vercel</strong> — website hosting.</li>
          </ul>
          <p>
            We may also disclose information if required by law — for
            example, in response to a valid court order or a request from
            a Pakistani regulatory or law-enforcement authority. We never
            share your health information with anyone else without your
            consent, except as described above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            5. Guest accounts and data retention
          </h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              If you consult as a guest (without creating a full account),
              your identifying details (name, email, phone) are
              automatically deleted after 15 days unless you convert to a
              full account during that time.
            </li>
            <li>
              If you had a paid consultation as a guest and don&rsquo;t
              convert, the clinical and payment record is kept (for
              bookkeeping, tax, and dispute purposes) but your name and
              contact details are removed from it, so it&rsquo;s no longer
              linked back to you personally.
            </li>
            <li>
              If a guest never completed a paid consultation, no record is
              kept past the 15-day window.
            </li>
            <li>
              For registered accounts, we keep your information for as long
              as your account is active, or as needed to meet our legal,
              tax, and recordkeeping obligations after you close it.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            6. How we protect your information
          </h2>
          <p>
            Access to patient health data is restricted at the database
            level so that, other than you and your attending physician,
            only authorized administrative staff can view it — and only
            what&rsquo;s strictly needed for their role. Passwords are
            never stored in plain text, and payment details are never
            stored on our systems at all.
          </p>
          <p>
            No system is perfectly secure, and we can&rsquo;t guarantee
            absolute security, but we take these obligations seriously and
            will notify you if we become aware of a breach affecting your
            data, as required by applicable law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">
            7. Your choices and rights
          </h2>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              You can review and update your account and family-member
              information at any time by logging in.
            </li>
            <li>
              You can request that we delete your account and associated
              personal data by contacting us at{" "}
              <a href="mailto:contact@thefamilymedic.com" className="text-teal-700 underline">
                contact@thefamilymedic.com
              </a>
              , subject to our need to retain certain records (e.g.
              completed consultation and payment history) for legal, tax,
              or dispute purposes.
            </li>
            <li>
              You can opt out of push notifications at any time from the
              bell icon in the site header, and can ask us to stop sending
              you non-essential emails.
            </li>
          </ul>
        </section>

        <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-lg font-bold text-slate-900">8. Contact us</h2>
          <p>Questions about this Privacy Policy or your data:</p>
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
