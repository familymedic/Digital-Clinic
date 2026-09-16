# Technical Audit Follow-Up — What's Missing, What Causes Inconvenience, and the Gap to "a Better Marham"
**Prepared:** 2026-09-16 · **Scope:** A focused technical re-audit, three days after the full 33-part audit (`business-model-audit-2026-09-13.md`). This document does not repeat that audit's business-model, legal, or clinical-safety findings — it picks up where the codebase has moved since (admin system, doctor onboarding, fee tiers/payouts, subscription foundation, daily caps, sponsored ads, site metrics, admin dashboard redesign) and answers three questions directly: what's still missing, what will actually annoy a doctor or a patient using this day to day, and — since the physician asked for "a better version of Marham" — where this platform stands against Marham's real, confirmed feature set.

**Method:** every finding below was verified against the current code, not assumed — either by reading the file directly or by grepping the schema/migrations for the thing in question. Where a claim comes from external research (Marham's own site, third-party case studies), it's cited. Nothing here is guessed.

---

## 1. Credit where it's due — what's already been fixed since the last audit

Three days ago, the audit's single most damaging finding was that the product called itself "AI-assisted" while having zero AI in it — a credibility risk with any technical due diligence. **That's now resolved.** Every patient- and doctor-facing surface (`consultation/[id]/history`, `doctor/consultations/[id]`, the terms page) now says "guided history" or "guided history-taking," never "AI." Confirmed by direct search across the codebase — this is no longer an open item.

Also genuinely closed since the 13th: the admin system exists now (safety-flag review, doctor management, payouts, subscriptions oversight, refund recording, feedback review, sponsored ads, business metrics — all RLS-verified); doctor self-registration with PMDC review and a required CNIC identity check; doctor-set consultation fees with tiered platform-share calculation flowing into real payout generation; a combined daily patient cap; platform-wide default text-availability hours; and a pre-launch data-cleanup script. This is real progress on the "no admin system, no multi-doctor path" critical findings from the 13th — those are no longer true as stated.

What's below is what's left, seen fresh.

---

## 2. Patient-facing gaps — ranked by how much they'd actually annoy someone

**Cannot cancel or reschedule a booked, paid consultation — anywhere.** Once a consultation leaves `pending_payment`, the patient dashboard only ever offers links to messages/call/history/prescription — never a cancel or reschedule action (`src/app/dashboard/page.tsx`). This isn't a UI oversight alone: the database itself has no state for it. The `consultations.status` column is constrained to exactly three values — `pending_payment`, `submitted`, `completed` (migration `0024`) — so "cancelled" isn't a status the system can even record today. A patient who double-books, picks the wrong family member, or simply changes their mind has no path except messaging the doctor directly and hoping. This is the single gap most likely to generate a frustrated first impression, and it's also exactly the kind of database change (new status value, RLS policy implications) that Section 38's change-control rule means should be scoped and confirmed with you before building, not done silently.

**No password reset, anywhere, for anyone.** Grepped the entire codebase for `resetPasswordForEmail`, "forgot password," any variant — zero matches. `AuthProvider.tsx` has no reset call, `login/page.tsx` has no "forgot password?" link. A patient or doctor who forgets their password is permanently locked out of their own account and medical history unless they contact you directly. This is a five-minute Supabase Auth feature to wire up and arguably should have shipped before anyone real logged in.

**Total silence after booking.** No email, SMS, or any notification exists for booking confirmation, payment success/failure, or "your prescription is ready" — confirmed by grepping every payment and webhook route for any send-mail/SMS call; the only notification trigger anywhere in the product is one internal email to you when a safety flag fires. A patient today finds out anything happened by logging back in and looking. This matters more than it sounds: Marham's own case study with its messaging vendor (Infobip) states plainly that adding SMS-plus-voice-failover notifications for "requested, confirmed, cancelled, or rescheduled" appointments raised their show-up rate from 52% to 55% and cut complaints 40–50% — this single feature is a measured, not theoretical, lever on the exact kind of inconvenience that drives support complaints.

**"Support" is a one-way form with no ticket ID, and Contact is a dead end.** `/feedback` lets a patient submit a free-text complaint, but there's no confirmation number, no status, no reply visible to them afterward — it's fire-and-forget. `/contact` — a link that sits in your main navigation — literally says "A contact form will be added in a future phase" and nothing else. A patient with an urgent question ("did my payment go through?") has nowhere real to go.

**No printable or downloadable prescription.** The prescription page says so itself: "A downloadable copy (PDF) isn't available yet." A Pakistani pharmacy or a second opinion expects a physical or PDF prescription, not a login-gated web page — this is a real-world usability gap, not a nice-to-have.

**Doctor directory has no real search.** `/doctors` filters by specialty only — no text search, no sort by fee, no filter by gender or language. Its "✓ PMDC Verified" badge is honest (every listed doctor is, by construction, `verification_status = 'approved'`) but deliberately never shows the actual PMDC number — a real, documented security tradeoff from migration `0028`, not an oversight, since the underlying table also holds certificate paths and rejection reasons that must never leak. Worth knowing as a conscious choice, not something to reflexively "fix," but a patient who wants to independently verify a doctor against the PMDC's own register currently can't do that from this site alone. Marham, by contrast, offers 100+ specialty filters plus city/location filtering and a manual staff-verification claim on every listed doctor.

**A family member can be added but never edited, removed, or corrected.** Only `AddFamilyMemberForm` exists in the whole codebase — confirmed by search. A typo'd date of birth or a family member who should be removed has no fix path today.

**No allergy field exists anywhere in the schema** (confirmed — zero matches for "allerg" across every migration), so a patient's known allergies are never recorded structurally; they'd have to be re-volunteered fresh in free text every single consultation, and nothing prompts for it. This is a real, if manageable-at-low-volume, clinical-documentation gap, not just a UX one.

**No account deletion or data-export option.** The only self-service account action anywhere is signing out.

---

## 3. Doctor-facing gaps — ranked by how much they'd actually annoy your doctors

**No way to see your own payout history.** `doctor_payouts` — the table admin uses to generate and track monthly payouts — is referenced only in admin pages (`admin/page.tsx`, `admin/payouts/page.tsx`). A doctor has no screen anywhere that says "here's what you've earned, here's what's been paid." Today that's you, so it's invisible; the day a second doctor joins, this becomes a real, recurring "can I see my payout" question with no in-app answer.

**Setting a weekly schedule means adding every slot by hand.** `doctor/availability/page.tsx` creates one slot at a time (a single date/time plus a capacity number) — its own code comment says a recurring-pattern generator was deliberately deferred. A doctor who works, say, Mon/Wed/Fri 9–5 has to individually create every one of those slots, every week, forever, until that's built.

**No "I'm on leave" switch.** The only way to stop new bookings temporarily is to manually delete every future slot — there's no single toggle that pulls a doctor out of the public directory and booking flow while preserving their configured schedule underneath, so it can just be flipped back on.

**The consultation queue has no filter or sort beyond newest-first.** No way to view flagged-only, or filter by delivery mode, or separate "needs scheduling" from everything else. Fine at low volume; will get noisy fast as consultation count grows.

**A doctor can't see a patient's history at a glance.** Opening a consultation shows only that consultation's own answers and demographics — not prior visits, prior prescriptions, or (see above) allergies. `FollowUpSettings` does let a doctor pick a past consultation from a dropdown when scheduling a follow-up, but seeing what actually happened in that past visit means separately navigating to it. For a family-medicine platform whose whole value proposition is continuity of care with one trusted doctor, this is a real product gap, not just a convenience one.

**Waiving a follow-up fee doesn't actually connect to anything.** The component's own on-screen text says it plainly: "nothing is charged or refunded automatically yet, and the patient doesn't see this yet." A doctor who waives a fee has no confidence the system will honor that, and the patient isn't even told.

**Doctor self-registration has no throttling.** `api/doctors/register/route.ts` creates a real Supabase Auth user with zero rate limiting or CAPTCHA — reachable by anyone, unauthenticated, repeatedly. Low real-world risk today at your traffic level, worth closing before the registration link is shared more widely.

---

## 4. Two failure modes worth naming precisely (technical, not UX)

**A patient bouncing off Safepay's checkout and retrying can create multiple payment rows for one consultation.** `startPayment()` on the payment page has no guard against being called repeatedly, and the API route inserts a fresh `payments` row every time it's called while the consultation is still `pending_payment`. Only one can end up `succeeded`, so there's no double-charge risk to the patient — but it does mean admin's payment records can accumulate stray `pending`/`failed` rows per consultation, worth a cleanup pass once real volume starts.

**If a real Safepay webhook payload doesn't match the field names this code guesses, the payment silently stays stuck forever.** The webhook route's own comments are honest about this: `extractOutcome()`/`extractOrderId()`/`extractTrackerToken()` are explicitly "plausible-but-unconfirmed guesses" about Safepay's real payload shape, since the sandbox test hasn't been run end-to-end yet. If a live payload doesn't match, the only trace is a `console.error` — nothing tells you or the patient that a specific payment needs a manual look. This was already flagged on the 13th as the single most important open loop; it still is, and it's the reason finishing the Safepay sandbox test (already in progress per the project docs) matters more than any feature below.

---

## 5. Benchmark against Marham, specifically

Researched directly against Marham's own site and a third-party case study about their notification system (Marham uses Infobip for SMS with voice-call failover) — not assumed from memory, since Marham's own feature set is exactly the kind of present-day fact that needs checking, not recalling.

| Capability | Marham (confirmed) | This platform today |
|---|---|---|
| Appointment notifications | SMS + voice failover for requested/confirmed/cancelled/rescheduled, plus reminders and post-visit review requests — measurably raised show-up rate 52%→55%, cut complaints 40–50% | None at all beyond one internal safety-flag email |
| Cancel / reschedule a booking | Implied as a first-class flow (their own notification copy explicitly names "cancelled" and "rescheduled" as states patients get messaged about) | Does not exist — no status for it in the database |
| Doctor search | 100+ specialties, city/location filter | Specialty filter only, no search box, no location, no fee sort |
| Credential display | Public PMDC number, staff-verification claim | "✓ PMDC Verified" badge, no number shown (deliberate security tradeoff) |
| Prescription delivery | Not confirmed on their public pages either — no advantage either way | No PDF/print export |
| Family accounts | Not offered by Marham or Oladoc, per the 13th's competitive research | Built and working — genuinely ahead here |
| Deterministic, physician-authored safety engine | Not applicable to a pure marketplace model | Built and working — genuinely ahead here |
| Free/forum-style consultation | A "free consultation with 3 doctors" + public Q&A forum | Not offered — plausibly not worth copying (dilutes the paid-consultation core, and a public health-advice forum carries its own moderation/liability burden) |
| Refund/complaint handling | Reputationally Marham's own worst weakness — Trustpilot shows heavy 1-star volume specifically over stuck refunds and unreachable support (13th's research) | Also weak today (a one-way feedback form, no ticket tracking) — an opportunity to be genuinely better, not a reason for complacency |

**The honest reading:** the two features most responsible for Marham's *operational* trust — notifications and cancel/reschedule — are exactly this platform's two biggest gaps. Meanwhile Marham's own most-cited failure mode (refunds and support disappearing into a black hole) is a gap here too, just not yet a reputational one because there's no real patient volume yet. Closing notifications, cancel/reschedule, and a real support-ticket flow before scaling isn't just catching up to Marham — given their documented weakness in exactly that area, it's the actual opening to be better than them, not just equivalent.

---

## 6. Prioritized recommendations

**Would stop a real patient or doctor cold — fix before wider use:**
Password reset (both roles); a real cancellation status and patient-facing cancel/reschedule action (needs a migration — flagging per Section 38, not building without your go-ahead); at least booking-confirmation and prescription-ready email notifications (Resend is already wired in for the one internal email, so this is extending existing infrastructure, not new integration work); finishing the Safepay webhook end-to-end verification (already in progress).

**Real inconvenience, worth doing soon after:** a proper support/refund request flow with a ticket ID and status the patient can check; a recurring-availability generator for doctors; a doctor's own payout-history view; a doctor "on leave" toggle; edit/remove for family members; a structured allergy field.

**Genuine product gaps, not urgent:** PDF prescription export; doctor-directory search/sort; a doctor's at-a-glance view of a patient's prior visits; rate-limiting on registration/contact forms.

**Worth having but low stakes today:** queue filtering/sorting for doctors; account deletion/data export; wiring the follow-up fee waiver to something real.

Nothing above requires touching clinical-safety logic, and nothing here should be read as "start building" — per how this project works, each of these gets scoped and confirmed with you individually before any code changes, especially the ones that touch the database schema or payment flow.

---

*This document supplements, and should be read alongside, `business-model-audit-2026-09-13.md` in the project — that document's business-model, legal/regulatory, and clinical-safety findings still stand and aren't repeated here.*
