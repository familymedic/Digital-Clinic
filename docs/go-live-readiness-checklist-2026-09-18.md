# Go-Live Readiness Assessment — 2026-09-18

**Prepared by:** Claude, at the physician's request ("start the assessment and tell me what steps are missing before we go live")
**Scope:** everything standing between the current state of the code/database and actually letting real patients use the site for real money. This is a status check, not a rebuild — nothing in this document changes the app; it's an honest inventory.

---

## 1. Database migrations — you are behind on your live project

Your real Supabase project reported `column doctor_profiles.bio does not exist` on 2026-09-16, which only happens if migrations haven't been run past a certain point. This is the single most likely reason other things feel broken right now, and it's the first thing to fix.

**Run these, in order, in the Supabase SQL Editor, whichever you haven't already:**

- `0034_doctor_profile_bio_and_cnic.sql` — doctor bio/years/photo/CNIC (this is the one causing the current error)
- `0035_sponsored_ads.sql`
- `0036_site_traffic_tracking.sql`
- `0037_consultation_cancellation.sql`
- `0038_payment_webhook_issues.sql`
- `0039_prescription_and_payment_notifications.sql`
- `0040_admin_patient_flow_metrics.sql` (new today — see Section 5)

Every migration in this project is written to be safe even if a couple before it were already applied (`add column if not exists`, `on conflict do nothing`), so running the whole range from wherever you actually stopped won't break anything already working. Quick way to check where you stand: `select bio, years_of_experience, cnic_number from doctor_profiles limit 1;` — if that still errors, start from 0034.

## 2. Environment variables

- **`RESEND_API_KEY`** — needed for the new payment-outcome emails (0039's app-code half). Same key value you already put in Supabase Vault for the safety-event email; it just also needs to exist as a plain environment variable in whatever hosts the Next.js app, since that call happens from application code, not a database trigger. Nothing works until this is set — the code fails open (no crash), it just silently skips sending.
- Everything else already documented (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SAFEPAY_*`) should already be in place from earlier phases — worth a quick check they're set wherever the app actually runs, not just in a local `.env.local` on your machine.

## 3. No live deployment yet

There is still no GitHub repository connected to a Vercel project (or equivalent). Everything so far has been tested against Claude's own environment and a local scratch database — never against a real public URL. This matters for two specific reasons below (Safepay and Daily.co), not just as a general checklist item. Until this exists, the site isn't reachable by anyone outside this conversation.

## 4. Payment gateway (Safepay) — the single most important open loop

- Checkout itself has been confirmed working in Safepay's sandbox.
- **The webhook has never been confirmed working end-to-end**, because Safepay needs a real public URL to call, and none exists yet (Section 3). Until a real webhook delivery is observed and inspected, the exact field names `extractOrderId`/`extractTrackerToken`/`extractOutcome` guess at in the code are still unconfirmed — flagged honestly in the code's own comments as "plausible, not verified."
- As of this session, an unrecognized or unmatched webhook payload is now at least logged somewhere admin-visible (`payment_webhook_issues`, migration 0038) instead of vanishing into a server log only you could see by digging — but that's a safety net, not a substitute for actually running the test.
- **Before real patients pay real money:** deploy, register the real webhook URL in Safepay's dashboard, run one real sandbox payment end-to-end, and check `/admin` for anything landing in the webhook-issues table. If the field names need adjusting once you see a real payload, that's a small, fast fix — but it has to happen before this is trustworthy with real money.

## 5. Video/audio calls (Daily.co) — never confirmed live

Built, but explicitly deferred per your own earlier instruction until a Daily.co payment method is on file. Treat this as "80% done" — the code exists, but no real two-sided call (camera + mic, both people) has ever actually been confirmed working. If any patients will use video or audio consultations at launch (versus text-only to start), this needs a real test first.

## 6. Legal — the engagement agreement is still a draft

`physician-engagement-agreement-DRAFT.docx` has never been reviewed by a lawyer and must not go to any doctor for signature as-is. Two sections were deliberately left unfinished rather than templated:

- **Section 16 (Limitation of Liability)** — left as a placeholder on purpose; a wrong liability clause is worse than none.
- **Section 12 (Regulatory Compliance)** — flagged for lawyer review, not independently verified.

Every doctor currently on the platform is working without a signed agreement. Worth deciding whether that's acceptable for a soft launch with doctors you personally know, or a hard blocker before onboarding anyone else.

## 7. Admin/operational setup

- Your own admin account already exists (confirmed — you're using `/admin` and hit today's doctor-profile bug from your own doctor-tab test account), so the earlier "create your first admin" blocker is resolved.
- **Pre-launch data cleanup**: `scripts/wipe_test_data_keep_admins.sql` exists and is tested, but has not been run. Every account created during development (patients, doctors, consultations, payments, feedback) is currently real production data sitting in your one live database. Decide when to run this — right before you actually open the doors, not before, since running it early would also wipe your own ongoing testing.
- Doctor engagement agreements aside, make sure every doctor who'll be live at launch has actually gone through `/doctor/register` → your approval at `/admin/doctors`, with CNIC and PMDC both verified, not left in a half-approved state from testing.

## 8. Functional gaps carried over from the 2026-09-16 audit (Critical tier already fixed)

The Critical tier — cancellation, password reset, payment/prescription email notifications, webhook failure visibility — was built and verified in the previous session (2026-09-16/17). Still open, by your own "one batch at a time" pacing choice, not yet started:

- **High:** a support/refund ticket flow with a reference number (today's feedback form is one-way, no ticket ID); a doctor payout-history self-service view; a recurring-availability generator (each slot is still created one at a time); a doctor "on leave" toggle; family-member edit/remove (only add exists today — confirmed again in this session); a structured allergy field (doesn't exist in the schema at all).
- **Medium:** PDF/printable prescription export; doctor-directory search/sort beyond specialty; a doctor-facing at-a-glance patient history view; rate-limiting on public forms.
- **Low:** queue filtering/sorting for doctors with growing patient lists; account deletion/data export; wiring the follow-up fee waiver into an actual free booking (see Section 10 below — this one came up again directly today).

None of these block a technically-working launch, but each is a real inconvenience a patient or doctor will hit in normal use, roughly in the order listed.

## 9. Suggested minimum bar before flipping this on for real patients

In order:

1. Run migrations 0034–0040 against the real project (Section 1).
2. Set `RESEND_API_KEY` (Section 2).
3. Stand up the GitHub → Vercel deployment (Section 3) — everything below needs a real URL anyway.
4. Register the real Safepay webhook and run one true end-to-end sandbox payment (Section 4) — check `/admin` afterward for anything in webhook issues.
5. Decide text-only vs. text+video/audio for launch day; if video/audio is in, confirm one real call works end-to-end first (Section 5).
6. Decide whether doctors can go live without a lawyer-reviewed agreement, or whether that's a hard gate (Section 6).
7. Run the pre-launch data-wipe script once everything above is confirmed and you're truly ready (Section 7) — this is a one-way action, so it's last, not first.

Everything in Section 8 can happen after go-live, in whatever order matters most once you're seeing real usage.

---

## 10. Three direct questions asked alongside this assessment

**Does the patient dashboard maintain medical history once someone is registered?**
Yes, permanently — this isn't session or device data, it's rows in the same Postgres database everything else lives in, scoped by Row Level Security to the account holder (`family_members.account_id = auth.uid()`). Every consultation, guided-history answer, safety event, and issued prescription for every family member stays attached to the account forever (or until you or the patient explicitly delete it — there's no auto-expiry). A patient logging in from a new device, months later, sees the exact same history. The one honest gap: there's no single **unified** longitudinal view yet — history is organized per-consultation (open consultation A, see its own history/prescription; open consultation B, see its own), not as one combined timeline across a patient's whole record. The dashboard's nav already has a "Health Records" link marked **"soon"** — that's the placeholder for exactly this, not yet built.

**Is there an option for uploading reports (e.g. lab results)?**
Partially. A patient (and doctor) can attach an image or PDF, up to 10 MB, **inside an ongoing text-mode consultation's message thread** — this already exists (migration 0022) and is private, stored in Supabase Storage with the same account-scoped access rules as everything else. The real gap: this only exists for **text** consultations. If a patient books an **audio or video** consultation, there is currently no way for them to upload a report at all — the message thread component simply isn't shown for those delivery modes. There's also no way to upload a report standalone (e.g. attach one to a booking before it's even matched to a doctor, or add one to an already-completed consultation afterward) — only during an open text conversation.

**Can a doctor grant a free follow-up so the patient isn't charged twice?**
Not really, and this is worth being precise about because the UI can look like it does this. The doctor-facing "Fee for this follow-up: Standard / Waived (free)" control (`FollowUpSettings`, on every consultation) **only writes a record to a `consultation_followups` table** — it has zero connection to the actual payment/booking flow. Concretely: today, a patient always has to pay full price to book any new consultation, follow-up or not, through the normal `/book` → payment flow; the doctor's "waived" mark is purely retrospective bookkeeping (originally scoped, per the migration's own comments, for a future payout-exclusion calculation once real billing existed). So right now, a patient whose follow-up the doctor intends to be free **will still be charged**, and marking it "waived" afterward doesn't refund or prevent that charge. This is the same gap the 2026-09-16 audit flagged ("follow-up fee waiver not wired to anything") — confirmed again today by reading the actual payment route, which never references `consultation_followups` or `fee_status` at all.

Actually wiring this up — a real "book a free follow-up" path — means changing the booking/payment decision logic itself (whether a given consultation requires payment before a doctor can act on it), which is exactly the kind of change Section 38 says to stop and ask about before touching, since it's payment logic, not a presentation-layer fix. I'd suggest one of two shapes, and would want your call before building either:

- **(a) Doctor pre-authorizes a specific free follow-up.** From an existing consultation, the doctor clicks "Allow a free follow-up for this patient," which creates a one-time voucher tied to that patient. The patient then sees a "Book your free follow-up" option (instead of the normal paid flow) the next time they book with that doctor, consuming the voucher. Cleanest, but is a real new flow to design and build.
- **(b) Waived-at-booking, admin-reconciled.** The patient books normally, no payment page shown at all when a doctor has already marked a specific prior consultation eligible; the consultation is created directly in `submitted` status with no payment row, and it shows up on your existing payout/admin screens as an explicit "waived — no charge" line rather than a payment. Faster to build, slightly less guided for the patient (they'd need to know to say which consultation it follows up on, same as the doctor does today).

Let me know which direction fits how you actually want this to work, and I'll scope and build it as its own batch.
