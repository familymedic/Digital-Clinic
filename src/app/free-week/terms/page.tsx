"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { fmtDay, useFreeWeekStatus } from "@/lib/freeWeek";

// Plain-language conditions for the free consultation week. The dates, the
// number of free consultations come from the live campaign
// settings, so this page can never disagree with what the site actually does.
export default function FreeWeekTerms() {
  const { status } = useFreeWeekStatus();
  const credits = status?.credits_per_account ?? 3;
  const dates =
    status && status.phase !== "none" && status.starts_on && status.ends_on
      ? `${fmtDay(status.starts_on)} to ${fmtDay(status.ends_on)}`
      : "the dates announced on the free week page";
  const h = "mt-7 text-base font-extrabold text-ink-900";
  const p = "mt-2 text-sm leading-relaxed text-ink-700";

  return (
    <div>
      <PageHeader title="Free Week Terms" subtitle="Simple conditions, written in plain language." />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="rounded-[26px] bg-white p-6 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-8">
          <h2 className="text-base font-extrabold text-ink-900">What the free week is</h2>
          <p className={p}>
            For {dates}, doctors who chose to take part offer free text and audio consultations to registered Family Medic accounts.
            These doctors are giving their time for free; no money is taken from you.
          </p>

          <h3 className={h}>Who can use it</h3>
          <p className={p}>
            A registered account with a valid email address and mobile number. Each family can register once, and each mobile number
            can be used for one family account. Walk-in (no account) bookings cannot claim free consultations. Please give your own,
            correct details. We may cancel free consultations booked with false or repeated registrations.
          </p>

          <h3 className={h}>How many</h3>
          <p className={p}>
            Up to {credits} free consultations per family account, shared by the people in that account. If you or the doctor cancel a
            free consultation before it happens, you get that free consultation back. Doctors set their own daily limits, so a doctor
            may become fully booked for a day.
          </p>

          <h3 className={h}>What is covered</h3>
          <p className={p}>
            Text chat and audio calls for non-emergency care. Video calls are not part of the free week. The consultation follows the
            same standards as a paid one: the doctor decides what is clinically appropriate, may ask you to see a doctor in person, and
            will tell you to go to hospital if your problem looks urgent. Free consultations are not for emergencies. If you have
            severe chest pain, trouble breathing, heavy bleeding, or someone is very unwell, go to the nearest hospital or call 1122.
          </p>

          <h3 className={h}>Afterwards</h3>
          <p className={p}>
            When the free week ends, normal Family Medic consultations continue as usual. Nothing is charged to you automatically, and
            you do not need to give any payment details to use your free consultations.
          </p>

          <h3 className={h}>Messages and privacy</h3>
          <p className={p}>
            Your mobile number is used to keep one registration per family and is never shown to doctors. We only send you news about
            offers if you tick the optional box when registering, and you can ask us to stop at any time. Messages about your own
            visits are always sent. Everything else is covered by our{" "}
            <Link href="/privacy" className="font-semibold text-teal-700 underline underline-offset-2">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="font-semibold text-teal-700 underline underline-offset-2">
              Terms of Service
            </Link>
            .
          </p>

          <h3 className={h}>Changes</h3>
          <p className={p}>
            We may change, pause or end the free week early (for example if too many people join for the doctors to cope). Free
            consultations already booked will be honoured wherever possible.
          </p>

          <Link href="/free-week" className="mt-8 inline-block rounded-full bg-teal-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-teal-800">
            Back to the free week
          </Link>
        </div>
      </div>
    </div>
  );
}
