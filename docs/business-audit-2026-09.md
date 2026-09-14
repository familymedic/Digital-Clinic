# Critical Audit & Business Model Validation
### AI Clinic Assistance — Family Physician Telemedicine Platform
**Prepared:** 2026-09-13 · **Scope:** Full product, clinical, security, and business-model audit, per the physician's 33-part master instruction. **Author's stance:** critical by design — this document actively looks for what's wrong, missing, or unproven, not what looks good.

**How to read the labels used throughout:**
**FACT** = independently verified (code inspection, a primary source I fetched, or arithmetic from confirmed inputs). **INFERENCE** = a reasonable reading of incomplete evidence, flagged as such. **ASSUMPTION** = a number or premise I chose explicitly for modeling purposes, stated so it can be swapped. **UNKNOWN** = could not be confirmed and should not be treated as settled. Nothing below claims legal compliance, medical-safety certification, or guaranteed pricing — those all need direct verification (a lawyer, PMDC/Safepay/Daily.co support, or a real pilot) before being relied on commercially.

---

## Executive summary (read this first)

Three findings dominate everything else in this audit, and they change the shape of the roadmap more than any UI or database decision:

1. **There is no AI in "AI-assisted history-taking" today.** The intake flow is a well-built, physician-authored, deterministic branching questionnaire (fixed questions, fixed multiple-choice answers, fixed red-flag rules) — genuinely safe, but not an LLM, not adaptive, and not what "AI-assisted" implies to a patient or a competitor doing due diligence. `package.json` has zero AI/LLM dependencies. This is either a real differentiator waiting to be built, or a claim that needs to stop being called "AI" until it is.
2. **There is no admin system at all.** Not "underdeveloped" — absent. Every operational lever (doctor onboarding, package configuration, content publishing, refunds, support tickets) currently requires the physician or Claude to write SQL by hand. This is the single largest launch blocker for anything beyond a solo practice.
3. **The platform is architecturally a one-doctor system wearing a multi-doctor-ready schema.** `doctor_id` exists everywhere; `doctors`, specialties, fees, PMDC numbers, and a doctor picker do not. Scaling doctors is a real, scoped, additive project — not a rewrite — but it hasn't started.

Set against that: the parts that *are* built — patient/family accounts, the consultation lifecycle, the deterministic red-flag safety engine, the doctor clinical workspace with locked-on-issue prescriptions, real Daily.co video, and a genuinely well-designed never-trust-the-client payment architecture — are built carefully, with real security boundaries (Row Level Security on every table, service-role gating, server-verified payment webhooks) that most first-time healthcare-tech builds get wrong. The engineering discipline is a real asset. The business is not yet a business — it is a well-built clinical tool with a payment button.

**Direct answer to "would I invest my own money and launch this today":** see Part 31 for the full reasoning — the short answer is **YES, BUT**, not yet, and not as a subscription business.

---

## Part 1 — Competitive landscape (Pakistan)

*Research conducted 2026-09-13 via live web search/fetch of competitor sites, app stores, review platforms, funding-news outlets, and academic sources. Every figure below is labeled; company self-reported numbers are marked as such, not treated as audited fact.*

### Marham (marham.pk) — FACT unless noted
Marketplace model: patient books a PMDC-verified doctor (doctor sets their own fee, roughly Rs. 500–3,000+), plus adjacent revenue lines in medicine delivery (markup) and lab bookings (referral fee), a "Marham for Teams" corporate product (terms not public — **UNKNOWN**), and pharma/hospital partnerships. **No consumer subscription or family package exists on the current site.** Self-reported (About page, **not independently audited**): 40,000+ PMDC-verified doctors, 1.5M+ consultations, 60,000+ patients/month. Funding: $1M seed (2021, Indus Valley Capital) — no later round found. **Commission/platform fee structure is not publicly disclosed anywhere** — a real information gap for anyone trying to model Marham's true unit economics.

**Reputation reality check (this matters for positioning):** Google Play 3.8★/11.3K reviews, but Trustpilot shows 1.4/5 across 90 reviews with 87% at 1-star. Recurring, specific complaints: money taken with no consultation delivered and refunds stuck for months; doctors shown as "available" who are actually offline; some doctors denying any affiliation with the platform at all (implying stale listings); slow, inconsistent support; users escalating to SBP/consumer-protection bodies over refunds.

### Oladoc (oladoc.com) — FACT unless noted
Same core marketplace shape, plus a real second business line: **"myPractice by oladoc,"** B2B practice-management SaaS sold directly to doctors — Oladoc monetizes doctors as software customers, not only as marketplace supply, which Marham does not appear to do. "Platinum Doctor" is a featured-tier mechanic (merit-based vs. pay-to-feature — **UNKNOWN**). Self-reported: 25,000+ doctors, 50M+ patients served (lifetime), 2.4M+ "subscribers" (almost certainly app users/newsletter, **not a paid plan** — no consumer subscription product was found). Funding: $1.1M (2018) + $1.8M pre-Series A (2022) — no later round found.

**Reputation:** Trustpilot 3.1/5, sharply polarized (45% 5-star, 50% 1-star). Same complaint categories as Marham — bookings the destination clinic disclaims knowledge of, refund denials (one report: Rs. 120,000 paid upfront for therapy, refused a refund after one session), rushed ~5-minute consultations.

### Other real, active Pakistani platforms (briefer profiles, FACT unless noted)
- **Sehat Kahani** — differentiates on mission/payer mix: women-doctor workforce reintegration, institutional/NGO/corporate/insurer contracts rather than pure consumer pay-per-visit. Raised $3M Series A; a 2024 press piece explicitly discusses surviving "a funding crunch" — real financial strain occurred at some point, current health **UNKNOWN**.
- **Ailaaj** — DRAP-licensed online pharmacy that gives away **free 5-minute doctor consultations** as a loss-leader to sell medicine (12,000+ SKUs); monetizes via commerce, not the visit. $1.6M seed (2021).
- **Dawaai** — primarily e-pharmacy; telemedicine is a bolt-on. Largest funding of the pure-commerce players found ($8.5M).
- **Healthwire** — broad "super-app" bundling telemedicine + pharmacy + labs, plus an unusual pharmacy-franchise investment product ("40% ROI" advertised). $3.3M+$700K across rounds.
- **MedIQ** — not a consumer competitor; sells EHR/telehealth infrastructure to hospitals/insurers/government. **Raised the single largest round found in this research ($6M Series A, May 2025)** — a real signal that sophisticated capital currently sees more defensibility in B2B health infrastructure than in consumer booking marketplaces.

### The moat question (INFERENCE, well-supported)
Marham and Oladoc are **structurally near-identical** — PMDC-verified directory, video/audio booking, lab/pharmacy bolt-ons, a featured-doctor tier, near-identical complaint patterns (refunds, no-shows, unreliable listings, slow support). Doctors appear to multi-home across platforms with low commitment. **The moat, if any, is brand recall + SEO dominance + raw listing breadth — not service quality or technology.** That is actually good news for a new entrant on quality alone, and bad news if the plan was to out-market incumbents on paid acquisition (see Part 19).

**A genuine white-space finding:** no major Pakistani platform researched currently offers a real consumer family-subscription product. The closest real-world analog is India's **Practo Plus**: ₹1,199–2,999/month for up to 3 family members, "unlimited" visits **capped in practice at 15/month**, 60-minute session window. This validates the *shape* of the physician's proposed plan (family bundling + a monthly cap, not truly unlimited) — but Practo's per-member price is far below the proposed PKR 2,000/3 members once currency and market differences are accounted for, which is a useful pricing-sanity anchor, not a direct benchmark.

### Patient attitudes (the most load-bearing citation in this section)
A 2025 peer-reviewed study (BMC Health Services Research / PMC, Pakistan primary-care telehealth) found telehealth satisfaction at 4.2/5 vs. 3.3/5 in-person, with cost as a major driver (telehealth ≈PKR 2,000 vs. ≈PKR 4,800 in-person, self-reported). But: **only 19.37% of respondents felt "extremely comfortable" with video-consultation privacy/security**, and about a third were dissatisfied with remote medication guidance. **No Pakistani patient-facing survey on AI-assisted intake specifically was found** — only physician/professional-side attitude studies exist, and those should not be extrapolated to patient willingness.

**Could-not-confirm list (Part 1):** exact commission/fee-split for Marham or Oladoc; either platform's real (non-self-reported) scale; whether either has raised funding recently; independent Pakistani patient data on AI-intake acceptance specifically; any platform's true CAC or paid-acquisition spend.

---

## Part 2 — Feature inventory: what's actually built (code-inspected, not assumed)

Read literally: a row marked "Functional" means the workflow works end-to-end against real tables with real RLS, verified in this project's own non-superuser test harness across every migration. A row marked "Exists but incomplete" means real code exists but the workflow has a known, named gap.

| Feature | Exists? | Functional? | Production-ready? | Missing pieces | Risk |
|---|---|---|---|---|---|
| Patient registration/login (Supabase Auth) | Yes | Yes | Yes | No password-reset UI verified in this audit (not inspected) | 🟢 Low |
| Family member management (add member, adult attestation, minor DOB) | Yes | Yes | Yes | No "remove/edit member" UI confirmed; no explicit minor-consent workflow beyond parental attestation | 🟡 Medium |
| Booking flow (complaint → who-for → delivery mode → slot) | Yes | Yes | Yes | Single doctor only — no doctor picker | 🟠 High (blocks multi-doctor) |
| AI-guided history intake | Yes | Yes, as a **deterministic questionnaire** | Yes for what it is, **not what it's named** | **No actual AI/LLM anywhere in the codebase** — see Part 13 | 🔴 Critical (naming/marketing risk, not a safety risk) |
| Emergency redirect (chest pain / shortness of breath) | Yes | Yes | Yes | Physician-approved wording, auto-flags for priority review | 🟢 Low — this is a real strength |
| Red-flag safety engine (per-answer, deterministic) | Yes | Yes | Yes | Rule-authoring still requires a migration (no admin UI) | 🟡 Medium (ops friction, not a safety gap) |
| Doctor email notification on safety event | Yes | Partially — **cannot be verified from this environment**, best-effort, fails open (never blocks the record) | Needs a real Resend key + live test | Single hardcoded notify-to address; no SMS/WhatsApp fallback | 🟠 High (a missed email is a missed emergency-adjacent flag) |
| Doctor login + queue + clinical workspace | Yes | Yes | Yes for one doctor | Not scoped for multiple doctors' *own* queues yet (schema supports it, UI doesn't branch) | 🟡 Medium |
| Assessment / prescription (draft → Approve & Issue, then locked) | Yes | Yes | Yes | **No PDF/printable export**, no drug-interaction or allergy check, no PMDC number shown on the record | 🟠 High (real-world usability + a documentation-completeness gap) |
| Follow-up fee control (standard/waived) | Yes | Yes | Yes | Only two states; no custom amount (deferred deliberately to Phase 10) | 🟢 Low |
| Consultation messaging (text mode, attachments, locks on issue) | Yes | Yes | Yes | No read receipts / typing indicators (not needed for MVP) | 🟢 Low |
| Video/audio calls (Daily.co) | Yes | **Unverified end-to-end** — blocked on a Daily.co payment method being added; idempotency bug already found and fixed once | No | Real live call never confirmed camera/mic working both sides | 🟠 High — explicitly deferred, not forgotten (physician's own call) |
| Payment collection (Safepay, PKR 500 consultation fee) | Yes | **Checkout confirmed working in sandbox; webhook confirmation unverified** (needs a public deployment) | No | Webhook payload shape genuinely undocumented by Safepay; needs a real end-to-end sandbox test post-deploy | 🟠 High — the single most important open loop right now |
| Multi-doctor support | **No** | — | — | No `doctors` table, no specialty/fee/photo/bio fields, no doctor picker, no per-doctor queue scoping | 🔴 Critical for any scale beyond one physician |
| Subscription / Family Care Plan | **No** | — | — | Scoped and reviewed once, explicitly not built (physician's own "do not build yet" instruction) | — |
| Admin dashboard / control panel | **No, at all** | — | — | Everything listed in Part 10 | 🔴 Critical |
| Public Health Updates section | **No** | — | — | Scoped once, not built | — |
| Ratings / reviews | **No** | — | — | — | 🟡 Medium (competitors have this, patients may expect it) |
| Refund workflow | **No** | — | — | Safepay dashboard is the only current refund path (manual) | 🟠 High once real money is flowing |
| Doctor payout tracking | **No** | — | — | Moot with one doctor who owns the merchant account; becomes essential the moment a second doctor joins | 🔴 Critical for multi-doctor |
| SMS / WhatsApp notifications | **No** | — | — | Only one email trigger exists (safety events); no booking confirmation, reminder, or "prescription ready" notification of any kind | 🟠 High (patients will not know to check the portal) |
| Support/complaint ticketing | **No** | — | — | — | 🟠 High before real patients |
| Voice-note intake | **No** | — | — | Scoped conceptually only (Part 14) | — |
| PMDC verification display / doctor credentials | **No** | — | — | Trust signal every competitor shows prominently | 🟡 Medium |

---

## Part 3–4 — Business model audit & subscription stress test

### First, a discrepancy to resolve before anything else
**The already-built payment code hard-codes the consultation fee at PKR 500** (migration `0024`, `src/app/api/consultations/[id]/payment/route.ts`). **This new instruction states the "initial idea" is PKR 350.** These are two different numbers currently live in two different places (one in production code, one in this brief). This needs an explicit decision, not a silent pick — the arithmetic below models both so the choice is informed rather than assumed.

### Pay-as-you-go unit economics (both prices modeled)
Assumptions used (**ASSUMPTION**, stated so they can be swapped): Safepay's confirmed fee schedule (2.9%+Rs30 card, 1.5% wallet/Raast), a 40% card / 60% wallet payment mix (Pakistani consumers skew heavily to wallets — JazzCash/Easypaisa — for small transactions), a delivery-mode mix of 60% text / 25% audio / 15% video, and Daily.co's confirmed per-participant-minute rate applied to a 12-minute average call.

| | **PKR 350 fee** | **PKR 500 fee** |
|---|---|---|
| Blended gateway fee/consult | PKR 19.21 (5.5%) | PKR 22.30 (4.5%) |
| Delivery (Daily.co) cost/consult | PKR 5.80 | PKR 5.80 |
| **Net per consultation (before doctor time/payout, before fixed hosting)** | **PKR 325** | **PKR 472** |

At PKR 350, gateway fees eat **7.1%** of revenue (worse at the card end — 11.5% on a card payment alone); at PKR 500 it's **4.9%** (8.9% on card alone). **PKR 350 is closer to the point where a run of card-paid, low-value transactions starts meaningfully denting margin** — not dangerous, but worth knowing before picking a number. Fixed hosting (Supabase Pro + Vercel Pro, both confirmed current pricing) is **~PKR 12,825/month (~$45)** regardless of volume — trivial once volume exists, a real fixed cost at zero-to-low volume.

Scaled out (doctors × consults/day × 30 days), a solo physician doing a realistic 20–30 consults/day nets roughly **PKR 195,000–425,000/month before their own time/opportunity cost** at PKR 350–500 respectively — the full table (1/5/10/25/50 doctors × 10/20/30/50/100 consults/day) is in the appendix at the end of this document. The headline: **pay-as-you-go economics work comfortably at either price** — the real constraint on this line of business is never server cost, it's doctor hours.

### The subscription stress test (Part 4) — the real finding

The literal server-cost arithmetic makes the PKR 2,000/3-members/8-consults plan look almost too good: at 100% utilization (all 8 consults used every month), Daily.co delivery cost is only ~PKR 46 and the one monthly gateway fee ~PKR 53 — a **95%+ gross margin on paper.** That number is true and also the wrong thing to look at. **The subscription's real cost is never infrastructure — it's the doctor's own time**, and that's where every one of the 16 stress-test scenarios below actually bites.

**The core economic tension, stated plainly:** PKR 2,000 ÷ 8 consultations = **PKR 250/consultation** if every slot is used — **50% of the PKR 500 pay-as-you-go price, or 71% of PKR 350.** A subscriber who uses all 8 slots every month is being sold the doctor's time at a real discount versus a walk-in patient. That's fine and standard (classic membership/insurance-style pooling — most subscribers won't use all 8) **only as long as usage is genuinely pooled across a large, randomly-mixed subscriber base.** A small, early subscriber base self-selects the opposite way: **the people who sign up first for a family-health subscription are disproportionately the ones who already know they'll use it heavily** (a family managing a chronic condition, frequent follow-ups, anxious new parents) — adverse selection working directly against the discount math.

**Walking the specific scenarios requested:**

- **A/B (family usage patterns):** No functional difference in the schema between "3 members split 8 consults evenly" and "1 member uses all 8" — the spec correctly calls for a *shared pool*, not per-person quotas, and nothing in the built payment/consultation architecture assumes otherwise. Operationally this is fine; the risk is entirely in *how many* total consults get used, not *by whom*.
- **C (abandoned/repeat checkout attempts):** Already handled correctly by the built architecture — a consultation only ever leaves `pending_payment` on a **server-verified** webhook, so an abandoned checkout just leaves an orphaned `pending_payment` row and an unused subscription slot; no financial exposure. A cleanup job to expire/cancel very old `pending_payment` rows doesn't exist yet — cosmetic (dashboard clutter), not a money problem.
- **D (book, don't attend):** **Not modeled anywhere in the current schema.** There is no "no-show" status distinct from a consultation just sitting unstarted. For pay-as-you-go this barely matters (paid = doctor's time was reserved regardless). **For subscription it matters a lot**: a no-show should almost certainly still consume one of the 8 slots (otherwise a subscriber can "attempt" consultations indefinitely at zero cost to themselves), but nothing currently marks or enforces that.
- **E (subscriber books a complex/long consultation):** The plan has no session-length cap (unlike Practo Plus's 60-minute window). A subscriber who structurally needs 45 minutes'-worth of doctor attention per visit costs the same "1 of 8" as a 5-minute refill request. This is a real design gap worth closing before launch, not after.
- **F (follow-up demanded):** Already built (0019) as a doctor-controlled waive/standard toggle — but it is **not currently linked to subscription entitlement at all**. A subscriber's follow-up either consumes a subscription slot or doesn't, and today nothing decides that; it needs an explicit rule (recommendation: a doctor-waived follow-up never consumes a subscription slot either, since "waived" already means "no charge" — treat subscription slot consumption and fee status as the same on/off switch, not two separate ones).
- **G (doctor cancels):** No cancellation status/workflow of any kind exists yet for any consultation, subscription or not. This needs to exist before launch regardless of the subscription question.
- **H (refund requested):** No in-app refund mechanism — only Safepay's own dashboard, manually. For a subscription this is worse than for pay-as-you-go: a mid-cycle cancellation refund needs to reason about "already used 3 of 8 consultations" — a proration calculation nothing in the current schema tracks.
- **I (patient changes doctors):** Irrelevant until multi-doctor exists; becomes relevant the moment it does, and the Section-required "eligible doctors per package" relationship (Part 27) is exactly the mechanism that would need to exist first.
- **J/K (multiple accounts / shared credentials):** **A real, currently-unmitigated loophole.** Nothing stops one person from registering two separate accounts, each with its own 3-member/8-consult subscription, at PKR 2,000/month each, to get 16 consults instead of paying more for one larger plan (there is no such larger plan) — or from simply sharing one login across an extended family beyond the 3 named members (the family-member limit is enforced at the UI/business-logic layer, presumably, but should be double-checked as a hard database constraint, not just a form validation). Neither is likely to be exploited at meaningful scale on day one, but both should be named as accepted risk, not silently assumed away.
- **L (doctor/patient collusion to generate consultations):** Low realistic risk for a solo/small practice where the doctor *is* the business — this scenario matters far more once doctors are paid per-consultation on a marketplace model (Part 9), where a doctor has an incentive to pad consultation counts. Worth a policy note now, an actual control (e.g., minimum consultation duration/interaction logging) only once payouts-per-doctor exist.
- **M (unused consultations expire):** Correctly scoped by the physician already as "no rollover for V1" — this is the right call and avoids a whole class of liability-accounting complexity. Needs to actually be enforced by a period-scoped entitlement table (Part 27's `subscription_periods` snapshot design), not just described in copy.
- **N (upgrade/downgrade mid-cycle):** Not designed. Recommend deferring past V1 — proration logic is exactly the kind of complexity Part 21 says to avoid pre-launch.
- **O (renewal payment fails):** This is a **real gap that needs to exist before subscriptions launch at all**, not an edge case to defer: a failed renewal needs an explicit `payment_failed`/grace-period state (already anticipated correctly in the physician's own state-list from the earlier subscription spec) so a subscriber isn't silently left with a "still active" plan the business never actually got paid for.
- **P (a doctor leaves while patients have active subscriptions eligible only for that doctor):** This is precisely why the spec's explicit, configurable "package → eligible doctors" relationship (rather than a single subscription flag) is the right architectural instinct — but it only helps if the admin system that manages that relationship actually exists (it doesn't yet), and if there's a defined patient-facing message for "your subscribed doctor is no longer available" (there isn't).

### Break-even and scale (see appendix table for full detail)
At the raw infrastructure-cost level, the subscription is profitable at every subscriber count and every utilization rate modeled (100 to 10,000 subscribers, 25% to 100% utilization) — gross margins stay above 95% throughout, because server/gateway costs are simply too small relative to PKR 2,000 to move the needle. **This is the wrong takeaway to bank on.** The real break-even constraint is **doctor capacity**: at 100% utilization, 1,000 subscribers generate ~267 consultations/day, requiring roughly **9 doctors working at a realistic 30 consults/day each** — and 10,000 subscribers at full utilization would need **~89 doctors**. A solo physician cannot responsibly sell more than roughly **100–150 active subscriptions** (at realistic, not worst-case, utilization) without either capping enrollment or bringing on more doctors first. **Selling subscriptions faster than doctor capacity grows is the actual way this business model becomes dangerous — not the PKR-to-server-cost math.**

### Recommendation on the subscription model
**Do not build this before the payment/video verification loop closes and before an admin system exists to manage packages, eligible-doctor mapping, and entitlement periods.** When it is built: (1) resolve the PKR 350 vs. 500 fee inconsistency first since the subscription's implied per-visit discount is calculated against it; (2) add a no-show policy that still consumes a slot; (3) add a renewal-failure/grace-period state before the first real subscriber is charged; (4) cap total active subscriptions to a number the current doctor roster can actually serve at full utilization, and enforce that cap in the admin system rather than assuming demand will stay low; (5) keep "no rollover" and "waived follow-up doesn't consume a slot" as the two simplifying rules that keep this tractable for V1. Consider, as a real alternative worth comparing rather than assuming away: a **consultation-credit pack** (e.g., "5 consultations for PKR 2,250, use within 60 days, no family bundling") — strictly simpler to reason about and to build, with none of the family-sharing or eligible-doctor complexity, as a first commercial test of "will anyone pre-pay for a bundle" before committing to the fuller family-subscription shape.


## Part 5–6 — Clinical safety & red-flag engine audit

**This is the strongest part of the build, and it deserves to be described precisely rather than praised vaguely.** The safety architecture is *not* AI-based at all — it is a deterministic rule table (`clinical_answer_options.is_red_flag`), authored and approved by the physician himself through a draft→approved gate on every table (`clinical_modules`, `clinical_questions`, `clinical_answer_options`, `consent_versions`), with nothing patient-facing until explicitly flipped to `approved`. This is, if anything, **safer than an LLM-based triage layer would be at this stage** — there is no hallucination risk because there is no generative model anywhere near the red-flag decision. The trade-off, honestly stated, is that it can only be as good as the finite set of questions and options the physician has written; it cannot ask a clarifying follow-up an LLM might think to ask.

**Emergency vs. urgent vs. routine, as actually implemented (not as commonly imagined):**
- **Emergency-equivalent:** Two complaints — "Chest pain" and "Shortness of breath" — **skip the questionnaire entirely** and show an immediate, physician-approved "seek emergency care now" message (`emergency_redirect_messages`), in the patient's chosen language, while still letting the consultation continue in parallel and auto-flagging it for priority doctor review. This is exactly the "don't send every patient to the ER" instinct the physician asked to be checked — it correctly reserves the hard redirect for two named, genuinely time-critical complaints rather than triggering on any single scary-sounding answer.
- **Urgent (flagged):** Any other complaint's questionnaire can produce a red-flag answer (`is_red_flag = true`), which creates a `consultation_safety_events` row, sets `is_flagged = true` on the consultation, and fires a best-effort doctor email — but does **not** redirect the patient away from the platform. This is a real design distinction from the emergency path and it is implemented correctly.
- **Routine:** everything else proceeds through the questionnaire normally.
- **Administrative/non-clinical:** N/A — there is no non-clinical intake path in this system (booking itself isn't gated by any clinical judgment).

**A red-flag example matching the physician's own "change in voice" caution:** because red-flag status is set per-answer-option by the physician himself (not by a generic keyword match), a module author *could* mistakenly mark something like "change in voice" as a red flag inside a sore-throat module — the architecture doesn't prevent an over-sensitive rule from being authored, it only prevents an *AI* from inventing one on the fly. The actual safeguard here is process, not code: every module ships as `draft` until the physician reviews and approves the specific wording and flags, which is the correct control, but it depends on him (or whoever authors future modules) exercising exactly the judgment the master instruction described. **Recommendation:** add a short written rubric (e.g., "a red flag should only be an answer option that a reasonable GP would independently escalate given zero other information") to keep future module authors — including any future junior doctor hired onto the platform — calibrated the same way.

**Real gaps, named plainly:**
- **No allergy/medication-interaction checking anywhere.** The prescription form (`AssessmentForm`) is free-text medicine name/dosage/instructions with zero structured drug database behind it — no duplicate-medication check, no interaction warning, no allergy cross-reference. For a solo GP prescribing common primary-care medications this is a manageable manual-diligence risk today; it stops being manageable the moment consultation volume or doctor count grows past what one careful person can hold in their head.
- **No pregnancy/pediatric/elderly-specific branching** beyond whatever a given module's questions happen to ask — there's no structural "this patient is a minor/pregnant/elderly, adjust the flow" logic; it depends entirely on individual module authoring.
- **No structured allergy field at all** on the patient/family-member record — a doctor has no persistent place to see "known penicillin allergy" across consultations; it would have to be re-asked and remembered fresh every time, or the module would have to ask every time (recommend the latter for now — safer than nothing).
- **Emergency-during-a-live-video-call** has no software-level protocol — if a patient deteriorates mid-call, the doctor's own clinical judgment and personal action (advising the ER, calling emergency services) is the only safeguard; nothing in the app assists or logs this. Reasonable for a solo GP, worth a written internal protocol regardless, since "what do you do if this happens on a call" is a training question, not a coding one.
- **No documented informed-consent-per-prescription** — a general AI-history consent exists (`consultation_consents`, Section 7), but there is no separate consent specific to "I understand this is a remote assessment and its limitations," which several jurisdictions' telemedicine guidance (including Pakistan's own non-binding 2021 draft policy, Part 7) specifically calls for.

**Bottom line for Part 5/6:** the AI-is-never-the-diagnostic-authority principle is genuinely, structurally enforced — there is no code path where a model outputs an assessment, diagnosis, or prescription; every one of those fields is typed by the physician and locked on issue. That is the single most important clinical-safety fact in this whole audit, and it holds up under inspection, not just under description.

## Part 7 — Privacy, security & compliance

*Legal/regulatory findings below come from a dedicated research pass against PMDC, Pakistani legislative sources, and SBP materials (2026-09-13) — labeled per the same FACT/INFERENCE/UNKNOWN convention, and none of it should be read as legal advice.*

### Regulatory reality (the part most builders skip, stated honestly)
- **PMDC has no binding, currently-published telemedicine-specific regulation.** A 2021 draft national policy exists (Ministry of NHSR&C, not PMDC) but was never confirmed finalized — and even as a draft, it envisioned **audio/video-only consultations (explicitly excluding text-only)** and **generic-name-only prescribing**, both of which this platform's current design conflicts with (it offers text-mode consultations and the prescription form allows any free-text medicine name, branded or generic). This is not a confirmed violation of binding law — there is no binding law — but it is a documented signal of the direction Pakistani regulation is likely to move, worth designing toward rather than against.
- **Pakistan has no enacted, general data-protection law as of this research.** A government-drafted Personal Data Protection Act awaits parliamentary passage; a separate Senate private bill was formally withdrawn. **There is no HIPAA-equivalent health-data law.** The only currently-enacted, generally-applicable statute touching unauthorized data access is PECA 2016 (a cybercrime law, not a privacy-rights regime) — multiple independent legal-commentary sources call it "inadequate for health-tech governance." **Practical consequence: the platform cannot truthfully claim compliance with any specific data-protection or health-privacy law, because none currently exists to comply with** — but it also isn't in violation of one, for the same reason. Marketing copy should say "we follow strong data-security practices," never "HIPAA-compliant" or "compliant with Pakistani data protection law."
- **Sindh has a provincial telemedicine act** (Sindh Telemedicine and Telehealth Act, 2021) that multiple secondary/academic sources treat as enacted (a 2026 peer-reviewed policy-analysis paper is built around it as existing law), though this research could not independently pull the primary gazette text. If reported provisions are accurate, it would require **practitioner registration/training before offering telehealth to Sindh residents** — directly relevant if the physician or any future doctor serves patients physically located in Sindh. **This specific point needs direct confirmation with a Sindh-based lawyer or the Sindh Health Department before scaling** — it is the single most concrete regulatory-compliance action item in this whole audit.
- **No confirmed law addresses AI-assisted clinical tools, remote prescribing of controlled substances, or minors' telemedicine consent specifically.** All three are genuine regulatory silences, not settled permissions. A sole-proprietor business does **not** need SECP registration to charge patients online (confirmed) — but does need an NTN from FBR, which is a real, current administrative to-do, not yet confirmed as done.

### Technical security (code-inspected — this is where the build is genuinely strong)
**Implemented, verified:** Row Level Security enabled on every patient/clinical/payment table, with the correct pattern (rather than trusting a client to hide a UI element) — server-side auth checks re-run the actual RLS-scoped query on every privileged API route (Daily.co room creation, payment initiation) before ever switching to a service-role client; the `payments` table has no INSERT/UPDATE/DELETE policy for anyone, so only the service-role webhook handler can ever write to it, enforced by Postgres itself, not application logic; a locked, issued prescription is genuinely immutable at the database level (RLS refuses further edits), not just hidden by a disabled form; the Safepay webhook is HMAC-SHA512-verified before any data is trusted; secrets (`SUPABASE_SERVICE_ROLE_KEY`, `DAILY_API_KEY`, `SAFEPAY_API_KEY`/`SAFEPAY_WEBHOOK_SECRET`) are consistently kept server-only with no `NEXT_PUBLIC_` prefix anywhere in the codebase (verified by grep). This is a genuinely above-average security posture for a first build.

**Needs legal/compliance validation (not code gaps, policy gaps):** data retention period (nothing defines how long consultation/prescription records are kept — indefinitely, by default, which is not necessarily wrong but should be a stated policy, not an accident); breach-notification process (none exists, and per the above, no Pakistani law currently mandates one — but a plan should exist regardless); a documented data-processing/sub-processor list for patients (Supabase, Daily.co, Safepay, Resend all touch patient data or payment data — no privacy policy currently names them, per a quick check of `/privacy`, worth confirming and updating).

**Missing outright:** audit logs of who (which doctor, which admin) viewed which patient record and when — there is currently no way to answer "who looked at this patient's data" beyond RLS having allowed it; account-deletion/data-export flow for a patient who wants their data removed (no code path exists); session/password-reset flows were not inspected in this audit pass and should be separately verified before launch; video-call recording — confirmed **not** implemented (good — recording without explicit, separately-tracked consent would be a real privacy risk, and it's simply absent rather than mishandled).

## Part 8 — Payments & financial operations

The core architecture is the right one and is already built: never trust a client-reported "payment successful," verify server-side via a signed webhook, keep a full audit trail (`payments` table, RLS-locked, one row per attempt). Safepay was chosen after real comparative research (not assumed) — sole-proprietor-eligible, one integration for cards + JazzCash + Easypaisa + Raast, real REST/webhook docs, transparently published fees (2.9%+Rs30 card, 1.5% wallet). This is genuinely more rigorous than most first-time builds get to on payments.

**What's still open, named without softening:** the actual Safepay webhook payload shape has never been exercised end-to-end (checkout works in sandbox; the webhook needs a public deployment to test — this is the literal next step, already in progress); there is no refund workflow in-app at all (Safepay's own dashboard is the only lever); no chargeback/dispute handling exists; no reconciliation report (a way to answer "does what Safepay says it paid out match what our `payments` table shows" doesn't exist yet, and should before real volume); doctor payouts are entirely moot today because the physician *is* the merchant of record — the moment a second doctor joins under a marketplace-style split, payout tracking and a commission model both need to exist and don't. **Do not assume Stripe or any foreign gateway is relevant here** — that instinct was already correctly avoided; Safepay/RapidGateway/local wallet rails are the right family of options, not a US-centric processor.


## Part 9 — Doctor operations

**Onboarding today (code-inspected):** there is no self-service doctor onboarding of any kind. A new doctor account is created by signing up through the normal patient registration form, then the physician (or Claude, at his instruction) runs a one-line SQL insert into `doctor_profiles` — which holds exactly two fields: `id` and `full_name`. No PMDC number, no specialty, no consultation fee, no photo, no bio, no languages spoken, no consultation-mode preferences. **This is the correct, deliberately minimal choice for a one-doctor MVP** (documented in the migration's own comments as intentional, not an oversight) — but it means "doctor operations" as a business function does not exist yet in any form beyond "the physician runs SQL."

**Doctor dashboard, as built:** a genuinely well-thought-out summary view — today's/waiting/completed counts, a dedicated safety-alerts tile, and a follow-up list correctly grouped into Overdue/Today/Tomorrow/Later (matching exactly what Part 9 of the master instruction asks for, before it was asked). What's missing from the dashboard, compared to the full list requested: **earnings/payouts** (moot with one doctor and no marketplace split, essential the moment that changes), **cancelled/no-show counts** (the underlying status doesn't exist yet — see Part 16), **patient ratings/complaints** (no such data exists anywhere), and **availability status at a glance** (availability is managed on a separate page, not surfaced on the dashboard itself).

**What a real doctor-network admin needs and doesn't have today, in priority order:** an application/review queue for new doctors (currently: none); a way to record and display PMDC registration number and specialty; a way to set commission/payout terms if the business ever moves beyond one physician's own solo income; suspension/deactivation (currently: a doctor row can only be deleted at the database level, with no graceful "deactivate, keep history" state); and a leave/unavailability toggle beyond just clearing future slots.

## Part 10 — Admin dashboard (conceptual design — nothing here exists yet)

There is genuinely nothing to audit in Part 10 — no `/admin` route, no admin-role concept, no admin-facing table anywhere in the schema. This section is a design proposal, not a review.

**Recommended shape**, built incrementally rather than all at once (see the roadmap in Part 33 for sequencing):

- **Executive overview:** total/active/new patients, active doctors, consultations today/week/month, revenue split by pay-as-you-go vs. subscription, refunds, cancellations, no-shows, doctor payouts, platform margin. Nearly all of this is derivable from tables that already exist (`consultations`, `payments`) — this is mostly a reporting layer, not new data modeling, once cancellation/no-show states exist (Part 16).
- **Operations:** live/waiting consultations, doctor availability at a glance, open safety-event queue (this already has real data behind it — `consultation_safety_events` — it just has no admin-facing view today, only the doctor's own email notification and dashboard tile).
- **Doctors:** applications, active/suspended roster, per-doctor performance and earnings — requires the `doctors` table expansion from Part 27 first.
- **Patients:** registrations, active subscriptions (once subscriptions exist), blocked accounts (no "block a patient" mechanism exists today at all — worth having before real-world abuse, even if rarely used).
- **Finance:** revenue, commissions, payouts, refunds, failed payments, reconciliation against Safepay.
- **Subscriptions:** active/renewals/failed renewals/cancellations/utilization/package profitability — entirely future, contingent on the subscription system being built.
- **Clinical safety:** an actual admin view of `consultation_safety_events` (open/reviewed/resolved) — the data model already supports this `status` field; nobody currently reviews or resolves these anywhere in the UI, only in the raw table.
- **Content:** publish/edit/archive Public Health Updates (Part 26) and manage clinical-module content (currently: SQL migrations only) — the single highest-leverage admin feature to build first, since it's what turns "the physician can approve new question wording" from a Claude-assisted migration into something he can do himself in five minutes.

**The honest priority call:** build this incrementally, driven by real operational pain, not as one big pre-launch project — a full "admin control center" is exactly the kind of feature Part 21 warns against over-building before validation. The one piece worth pulling forward regardless of launch timing is **safety-event review and clinical-content publishing**, because both currently require Claude's involvement to change anything, which does not scale to "the physician runs this business day to day."

## Part 11 — Patient dashboard audit

**What exists today, code-inspected:** family member list, consultation list with status, a payment-required banner and action link, links into messages/call/history/prescription per consultation. This is a real, working "what can I do right now" surface for the features that exist — booking, checking status, paying, joining a call, reading a prescription.

**What a Pakistani patient would likely expect and doesn't find here, benchmarked against Marham/Oladoc:** any doctor discovery/search at all (moot with one doctor, a real gap the moment a second joins — Part 27); a visible remaining-consultations count for a subscription (N/A until subscriptions exist, but the "X of Y remaining" pattern the physician specified is exactly right and should be built as a first-class dashboard element, not buried); payment history/receipts (only the raw `payments` table exists — no patient-facing view of past payments); a support/help entry point (does not exist anywhere in the app); any emergency-help shortcut beyond the static banner text (the banner itself is a real, good pattern — a small addition worth considering is making "seek emergency care" a persistently visible action, not just a page-top notice, on every screen while a consultation is active).

**Assessment against "communicates what to do in seconds":** for a returning patient with an active consultation, largely yes — status, next action, and links are clear and un-cluttered. For a first-time patient with zero consultations, the dashboard has comparatively little to orient them (no "book your first consultation" prominent call-to-action was inspected as existing beyond standard navigation) — worth a first-time-user empty state specifically, which is a cheap, high-value fix.

## Part 12 — Family account architecture

**Structurally sound, code-verified.** One `auth.users` login → many `family_members` rows, each with its own `relationship`, `date_of_birth`, and an `attestation_confirmed` flag (adults added by the account holder confirm consent/authority via checkbox; minors need none, on the reasonable theory of ordinary parental authority). Every consultation, history response, safety event, and prescription is scoped through `family_members.account_id = auth.uid()` in RLS — meaning **one family member's medical record is never visible to another family member directly**; it is only ever visible to the one account holder who manages the whole family, which is the intended and correct model (the spec explicitly wants a single account holder to see the whole family's activity, not peer-to-peer member privacy). Consent for a minor's consultation is implicit in the account holder's own authority to add that family member — there is no separate, explicit "confirm you are consenting to this specific consultation for this minor" step at booking time, which is a reasonable simplification for now but worth revisiting if any regulatory guidance (Part 7) ever gets more specific about minors' telemedicine consent.

**Real gaps:** no "remove/edit a family member" UI was found (only add); no way to correct a wrong date of birth once entered; no hard database-level cap on family-member count (relevant the moment a "3 members per subscription" rule needs enforcing — today nothing stops a fourth, fifth, or twentieth family member being added, which is fine for pay-as-you-go but is a real subscription-loophole precursor per Part 4's scenario J/K).


## Part 13 — AI history-taking audit (the most important correction in this document)

**Restated plainly because it matters more than any other single finding: there is no AI here.** `clinicalHistory.ts` and its supporting migrations implement a physician-authored, versioned, draft/approved-gated **branching multiple-choice questionnaire** — real questions, real answer options, real red-flag rules, all typed in by the physician (or Claude, under his review) ahead of time. There is no call to any language model anywhere in this codebase; `package.json` lists zero AI SDK dependencies (no OpenAI, Anthropic, or any other LLM client). "AI-guided history" in the product's own naming and in the physician's messages throughout this project describes what is, today, a **static clinical questionnaire**.

This is not a criticism of the engineering choice — a fixed questionnaire is arguably *safer* than an LLM at this stage (Part 5/6), and it was very likely the right MVP choice. It **is** a naming and expectations problem that needs a decision: either (a) keep calling it "guided history" or "structured intake" honestly, which costs nothing and removes a claim that doesn't hold up under any technical due diligence, or (b) actually build an LLM-assisted layer on top of the existing approved-question framework (e.g., an LLM that helps a patient articulate free-text answers into the existing structured options, or that summarizes a completed questionnaire into a cleaner note for the doctor — never one that decides red flags or writes an assessment) — which is a real, buildable differentiator (Part 24) but a genuinely new feature, not a description of what exists.

**Does the current design intelligently avoid a 30-minute questionnaire?** Yes, by construction — each complaint module is a short, fixed set of questions (not an open-ended interview), and the two most time-critical complaints skip the questionnaire entirely in favor of an immediate redirect. This is good design regardless of whether an LLM is ever added.

**Does it avoid the AI-diagnoses/prescribes trap?** Unambiguously yes — there is no generative content anywhere near a diagnosis or prescription field; every one of those is doctor-typed, and RLS locks it on issue. This is the one place where the audit's overall skepticism should be tempered: this specific boundary is genuinely, structurally enforced, not just described in copy.

## Part 14 — Voice-note option (not built; audited as a proposal only)

No speech-to-text of any kind exists in the codebase today (`history_method` supports a `voice_note` value in the schema, but no code path implements it — a stub, not a feature). Current, confirmed per-minute pricing if this is built later: OpenAI's current transcription model at ~$0.0045/minute, or Google Cloud Speech-to-Text V2 at ~$0.016/minute (both confirmed current published rates; Urdu-language quality for either was **not independently verified** in this research and should be piloted before committing). At either price, transcription cost is negligible per consultation (well under PKR 3 for a 5-minute voice note) — cost is not the blocker here.

**The real limitation, correctly anticipated by the master instruction:** a voice note is fundamentally less structured than the existing questionnaire — it can omit exactly the information a fixed question would have forced the patient to address (duration, severity, associated symptoms), and free-form speech in mixed Urdu/English/Roman Urdu is harder to parse reliably into the same structured `consultation_history_responses` table the red-flag engine depends on. **Recommendation:** if built, a voice note should supplement, never replace, the structured questionnaire — e.g., an optional "add anything else in your own words" voice note attached to a consultation that the doctor listens to directly, rather than a transcription that gets algorithmically mapped into red-flag-triggering answer options. Auto-mapping free speech into red-flag rules would reintroduce exactly the hallucination/misclassification risk the current deterministic design was built to avoid.

## Part 15 — Prescription system

**What's built and solid:** medicine name/dosage/instructions per line item, assessment/advice/referral/follow-up fields, a genuine draft→"Approve & Issue" gate that locks the record at the database level (not just the UI) once issued, and a patient-facing read-only view that is structurally incapable of showing a draft (RLS returns nothing until `status = 'issued'`).

**What's missing for real clinical use, named directly:** no PMDC registration number or doctor credential shown anywhere on the issued record (a real prescription in Pakistan conventionally carries this); no generic-vs-brand distinction (relevant given the non-binding draft national policy's generic-name-only stance, Part 7); no allergy or interaction warning of any kind (Part 5/6); no timestamp-of-diagnosis distinct from timestamp-of-issue shown to the patient; and — the most immediately practical gap — **no downloadable or printable format** (PDF or otherwise). The page itself says so honestly ("A downloadable copy (PDF) isn't available yet"). This matters more than it might seem: a Pakistani pharmacy or a second opinion typically wants a physical or PDF prescription, not a login-gated web page — this is a real pre-launch, not post-launch, gap.

## Part 16 — Consultation lifecycle & failure points

Mapping the built lifecycle against "what happens if this fails," stage by stage:

| Stage | Built? | What happens if it fails today |
|---|---|---|
| Booking → payment | Yes | **Handled well**: consultation is saved immediately as `pending_payment`, invisible to the doctor, before any payment attempt — booking is never lost even if payment never completes. |
| Payment succeeds but webhook never arrives | Possible (webhook payload shape unconfirmed) | Consultation stays stuck in `pending_payment` indefinitely; patient sees a "pending" state with a retry button, but there is **no admin-facing way today to manually reconcile** a payment Safepay actually captured against a consultation the app still thinks is unpaid. This needs a manual-override tool before real volume. |
| Doctor does not join a scheduled call | Not handled | No no-show/missed-appointment status exists; nothing notifies the patient or reschedules automatically. |
| Patient does not join | Not handled | Same gap, symmetric. |
| Internet disconnects mid-call | Not handled by the app | Daily.co itself may reconnect a participant, but nothing in this codebase detects or logs a dropped call, and there's no automatic "resume" affordance beyond re-navigating to the same join page (which should still work, since a fresh token is minted per join — a real, if accidental, resilience feature). |
| Daily.co API itself fails/errors | Partially handled | The idempotency fix (Part 2) handles one specific failure mode (duplicate room creation); a genuine Daily.co outage has no fallback (e.g., no "switch to audio-only" or "reschedule" offer). |
| Prescription fails to save | Handled reasonably | `persistDraft()` returns an explicit error message rather than silently losing data; the doctor sees it and can retry — no data loss path was found. |
| AI/transcription service fails | N/A today | No such service exists yet to fail (Part 13/14). |
| Doctor or patient cancels | **Not handled at all** | No cancellation status, no notification, no refund trigger. This is a genuine pre-launch gap, not a nice-to-have. |
| Follow-up requested | Handled | Doctor-side toggle (0019), correctly separate from the payment-gating logic (Part 4 flags the one place these two need to be explicitly reconciled for subscriptions). |

**The two failure points that matter most before real patients:** (1) no cancellation/no-show status anywhere in the schema — this blocks honest doctor-dashboard metrics, subscription slot accounting, and basic patient communication ("your appointment was cancelled") all at once; (2) no manual payment-reconciliation tool for the exact scenario Safepay's own webhook-shape uncertainty makes plausible (Part 8). Both are small, additive schema/UI changes, not architectural problems.

## Part 17 — Notifications

**What exists:** exactly one notification, anywhere in the entire product — a best-effort email (via a database trigger calling Resend) to the physician when a safety event fires, deliberately fail-open (never blocks or loses the underlying clinical record) but also **never independently verified as actually sending**, since it needs a real Resend API key and a live test (Section 41 limitation, same as Daily.co and Safepay).

**What does not exist, at all:** any notification to the *patient* of anything — no booking confirmation, no "your doctor issued a prescription," no appointment reminder, no payment receipt, no renewal-due notice. A patient today only ever finds out anything happened by logging back into the portal and looking.

**Recommendation on what to build first vs. later, since notifications are exactly the kind of feature Part 21 wants triaged rather than built wholesale:** *now* — a patient-facing email (Resend is already integrated at the infrastructure level) for "your prescription is ready" and "your payment succeeded/failed," since both are moments a patient will otherwise sit wondering; *soon after launch* — an appointment reminder (email is fine to start; SMS/WhatsApp add real per-message cost, confirmed above, and meaningful integration effort with a Pakistani BSP); *later* — WhatsApp notifications specifically, once volume justifies the BSP relationship and monthly platform fee (roughly PKR 3,000–14,000/month depending on vendor, confirmed research above) — WhatsApp is very likely the channel Pakistani patients actually check, more than email, so this should not be deferred indefinitely, just sequenced after the cheaper channel proves the notification *content* is right.

## Part 18 — Customer support

**Nothing exists today** — no FAQ beyond the static public marketing page, no in-app contact/support form, no complaint intake, no refund-request flow, no distinction between a technical issue and a clinical complaint. For a healthcare business specifically, "how do I complain about my consultation" and "how do I get a refund" are not optional pre-launch features — both Marham and Oladoc's worst reputational damage (Part 1) comes from exactly this gap being handled badly, not from their core clinical product. **Recommendation:** the minimum viable version is a single support-request table (category: technical / billing / clinical-complaint / refund-request; status: open/in-progress/resolved; linked optionally to a consultation) with an admin-facing list and a patient-facing "contact support" form — genuinely small to build, disproportionately important to have before the first real complaint arrives with nowhere to go.


## Part 19 — Business growth model (go-to-market)

**Building the platform does not create patients — this needs to be said plainly given how much engineering effort has gone into the product relative to zero effort so far into acquisition.** Given Part 1's finding that Marham/Oladoc's moat is brand recall + SEO, not technology, out-marketing them head-on with a solo physician's budget is not realistic. The more defensible path, consistent with what actually differentiates this platform (Part 24):

- **Start with the physician's own existing patient relationships** — this is true of nearly every solo-doctor telemedicine launch anywhere, and it's the one acquisition channel that costs nothing and converts best (existing trust already exists). This should be the entire Phase 3 (validation) acquisition strategy, not a footnote.
- **WhatsApp, not paid social, is very likely the highest-leverage channel for a Pakistani family-medicine practice** — low cost, matches how patients already communicate with their doctor's office informally, and doesn't require competing with Marham/Oladoc's SEO spend.
- **Community/local channels** (mosque/school/community-center flyers, local pharmacy partnerships for referral, word-of-mouth from satisfied family patients) plausibly outperform digital-first acquisition at this scale, given the trust-deficit patients report in Part 1's review-site findings for incumbents — a new entrant who is *reliably good* has more to gain from word-of-mouth in a market where "the market leaders sometimes just don't deliver the consultation" is a real, documented pattern.
- **SEO and corporate/employer packages are real but slow** channels not worth investing in before Phase 3 validation — they take months to pay off and distract from proving the core loop works with real patients first.
- **Do not build a marketplace-scale acquisition strategy for a solo-doctor business** — this is a Part 21 "do not build yet" call as much as a marketing one.

## Part 20 — Unit economics

Full pay-as-you-go and subscription tables are provided in Part 4 and the appendix; the headline: **pay-as-you-go economics are healthy at either PKR 350 or 500**, gated only by doctor hours, not infrastructure; **subscription economics look artificially excellent on a pure server-cost basis and are actually gated by the same doctor-hours constraint, just hidden by a much larger apparent margin** — this is the single most important number in this whole audit to internalize before selling a single subscription (restated from Part 4 because it's easy to read the margin table and miss the capacity constraint underneath it).

## Part 21 — MVP vs. full business

**MUST HAVE before launch (real patients, real money):** a cancellation/no-show status (Part 16); a manual payment-reconciliation path for the webhook-shape uncertainty (Part 8); a patient-facing support/complaint intake (Part 18); at least one patient-facing notification beyond silence (prescription-ready, payment status — Part 17); a downloadable/printable prescription (Part 15); resolving the PKR 350 vs. 500 fee discrepancy (Part 4); completing the deferred Daily.co and Safepay end-to-end verification (already in progress, correctly sequenced by the physician's own "verify when it becomes impossible to proceed without it" rule).

**SHOULD HAVE soon after launch:** structured allergy field + basic drug-duplicate checking (Part 5/6/15); a minimal admin view for safety-event review and clinical-content publishing (Part 10); basic doctor-facing earnings visibility (moot alone, but cheap to add and needed the moment a second doctor exists); WhatsApp notifications once volume justifies the BSP cost (Part 17).

**NICE TO HAVE:** ratings/reviews; PMDC credential display; a richer patient dashboard empty state for first-time users; voice-note intake (Part 14) — genuinely useful, genuinely not urgent.

**DO NOT BUILD YET:** the Family Care Plan subscription (Part 4 — not until doctor capacity, admin tooling, and the cancellation/renewal-failure states all exist); multi-doctor marketplace features (payouts, commission splits, doctor discovery) until a second real doctor is actually being onboarded; Public Health Updates section (real, low-risk, but not load-bearing for validating the core clinical/commercial loop); any LLM-based intake enhancement (Part 13) before the deterministic version has real patient usage data to justify it; loyalty programs, coupons, referral networks, multi-currency, corporate billing — all explicitly out of scope per the physician's own instruction, and this audit agrees with that call on every one of them.

## Part 22 — Technology architecture audit

**Stack assessment:** Next.js 16 + TypeScript + Supabase/Postgres + Vercel + Daily.co is a reasonable, unremarkable, low-vendor-lock-in choice for this scale — nothing here is a red flag. RLS-as-primary-defense (rather than application-layer authorization alone) is the correct architectural instinct for healthcare data and has been applied consistently across every migration inspected. Secrets hygiene is good (verified by direct grep — no service-role-style secret anywhere carries a `NEXT_PUBLIC_` prefix or appears in client code). There is no rate limiting or abuse-prevention layer on any API route inspected (the payment-initiation and room-creation routes both trust Supabase Auth's own token validation but have no additional throttling) — low risk at current volume, worth adding before real public traffic.

**Scale honesty check, by user count:**
- **100 users:** current architecture handles this without any changes.
- **1,000 users:** still fine on Supabase Pro/Vercel Pro; the doctor-hours constraint (Part 4/20) becomes the real bottleneck long before infrastructure does.
- **10,000 users:** database indexing and query patterns were not load-tested in this audit and should be before this scale; multi-doctor architecture (Part 27) becomes mandatory, not optional, well before this point.
- **100,000 users:** would need a genuine multi-doctor, admin-tooled, notification-complete platform — essentially everything flagged as missing in this document — plus infrastructure review (connection pooling, read replicas) not yet assessed. Not a realistic near-term planning horizon given the doctor-capacity ceiling identified in Part 4.

**Logging/observability/monitoring:** none was found beyond default Vercel/Supabase platform logs — no structured application logging, no uptime/error monitoring (e.g., Sentry) integrated. Cheap to add, currently absent.

## Part 23 — Cost audit

*All figures below are current, confirmed vendor pricing (researched 2026-09-13) unless marked ASSUMPTION; PKR conversions use ~PKR 285/USD as a planning rate — confirm the live rate before finalizing a budget.*

**Fixed monthly costs (independent of volume):** Supabase Pro $25 + Vercel Pro $20 = **$45/month (~PKR 12,825/month)**. Resend stays free at low volume (3,000 emails/month free tier). Domain: ~PKR 1,500–2,000/year for a `.pk` domain, or ~$15–18/year for `.com` (both confirmed current registrar pricing) — negligible, amortized monthly.

**Variable cost per consultation:** Safepay's blended gateway fee (~PKR 19–22 depending on the PKR 350 vs. 500 decision and card/wallet mix) + Daily.co delivery cost (~PKR 27 for a 12-minute video call, ~PKR 7 for audio, PKR 0 for text — and the first 10,000 minutes/month are free on Daily.co regardless, confirmed). **Total variable cost per consultation is roughly PKR 6–46 depending on delivery mode** — small relative to either proposed consultation fee.

**Variable cost per active subscriber (if built):** the same Daily.co/gateway math applied to whatever fraction of the 8 included consultations actually get used, plus one monthly gateway fee for the renewal charge itself (~PKR 53) — modeled in full in Part 4.

**Not yet costed anywhere, flagged honestly:** customer support labor (currently the physician's own time — a real opportunity cost, not a cash cost, until support volume requires hiring); WhatsApp/SMS notification cost once built (confirmed rates in Part 17: ~PKR 1.50/utility WhatsApp message, ~PKR 4/SMS, both third-party-estimated rather than vendor-rate-card-confirmed — get a direct quote before budgeting precisely); any future LLM API cost (negligible per the confirmed token pricing above — roughly $0.002–0.016 per consultation depending on model choice, i.e., under PKR 5, if an LLM layer is ever added); monitoring/observability tooling (not yet selected); legal/compliance review (Part 7's Sindh-registration question and a basic privacy-policy/terms review are real, one-time costs worth budgeting for before scaling, even though this research found no enacted law requiring them).


## Part 24 — Competitive positioning

**"Because we offer online consultation" is not a moat — the master instruction is right to pre-empt that answer, and Part 1 confirms two well-funded incumbents already offer exactly that.** What could realistically differentiate this platform, assessed honestly rather than optimistically:

- **A genuinely well-built deterministic safety layer with real physician sign-off on every question** — real today, but invisible to a patient comparing apps at a glance; this is a *trust* differentiator, not a *marketing* one, and would need to be communicated through outcomes (fewer missed red flags, visible physician credentials) rather than a feature list.
- **Family-first design (shared account, shared subscription, structured family-member records)** — real and, per Part 1, genuinely not matched by either Marham or Oladoc's public product today. This is the most concrete, defensible differentiation candidate found in this entire audit.
- **"AI-assisted" as an actual, working feature** — not real yet (Part 13). Claiming it before building it is the single fastest way to lose credibility with any patient or investor who asks a follow-up question.
- **Continuity of care / structured records with one trusted physician** — plausible and consistent with a family-medicine positioning, but unverified against actual patient behavior (Part 1's research found no Pakistan-specific data on whether patients value continuity over convenience in telemedicine specifically).
- **Transparent pricing and reliability** — genuinely achievable low-hanging fruit given Part 1's finding that incumbents' worst reviews are about refunds and no-shows, not their core product; **being reliably good at the basics may be worth more than any single feature**, given the market's documented trust deficit.

**Do not assume these are advantages without testing them** — per the master instruction's own caution. The one claim this audit is comfortable calling a real, currently-existing advantage is the family-account architecture; everything else is a hypothesis worth validating with the first 100–500 real patients (Part 33), not a settled fact.

## Part 25 — Brand trust

Checking the current public site and portal against what a hesitant Pakistani patient would look for before paying: PMDC verification is **not displayed anywhere** (no doctor-profile page exists at all yet — Part 27); privacy/data-handling assurances exist as generic legal-page text (`/privacy`, not independently re-read line-by-line in this audit pass, worth a dedicated review against Part 7's findings so it never overclaims compliance with a law that doesn't exist); the emergency-limitation disclaimer is real and good (`EmergencyBanner`, shown site-wide); a refund policy is not visible anywhere in the current app (Part 8/18); transparent pricing is currently accurate (PKR 500 shown at checkout, matching what's charged — a real strength given Part 1's finding that hidden/inconsistent pricing is a top incumbent complaint). **Every point where a patient might hesitate maps directly to a Part 21 "must have before launch" item** — refund policy, support contact, and doctor credentials are simultaneously trust gaps and functional gaps, which is exactly why they're prioritized early in the roadmap (Part 33).

## Part 26 — Legal / policy documents needed

Documents that should exist before real-money launch (content not drafted here — this audit identifies what's needed, per the master instruction's own caution against writing legally definitive text without review): Terms of Service and Privacy Policy (both already exist as pages — verify their actual content matches Part 7's findings, e.g., they should **not** claim compliance with a law that doesn't exist in Pakistan); a telemedicine-specific consent disclosure (distinct from the existing AI-history consent) stating plainly what a remote consultation can and cannot do, and when to seek in-person/emergency care instead; a refund/cancellation policy (does not exist in any form today); subscription terms, once subscriptions exist (rollover, family-member limits, eligible-doctor restrictions all need plain-language disclosure, not just database enforcement); a doctor agreement/code of conduct, once a second doctor is onboarded; a data-retention statement (Part 7 — currently undefined even internally, let alone disclosed). None of this needs to be legally perfect before a soft launch to the physician's own existing patients, but all of it should exist before any paid marketing or public-facing scale-up.


## Part 27 — Database / data model audit

**The core hierarchy (Account → Family Member → Consultation → Clinical Record, with `doctor_id` on every consultation from day one) is genuinely sound and was clearly designed with multi-doctor and future-payment needs in mind before either existed** — this is real, credited design discipline, not luck. The draft/approved-gate pattern repeated across every clinically-authored table (`clinical_modules`, `consent_versions`, `emergency_redirect_messages`) is consistent and correct. RLS-as-primary-boundary, with the "no permissive policy = hard deny regardless of table grants" pattern used deliberately for `payments` and `consultation_messages`, is a genuinely sophisticated and correct use of Postgres's own guarantees rather than relying on application code to get authorization right every time.

**What will become hard to change later if not addressed before scale, named specifically:**
- **No `doctors` table with public profile fields (specialty, PMDC number, fee, photo, bio, languages).** `doctor_profiles` today is two columns. Adding this is additive (a new table + a few joins), not a rewrite — but it should happen before, not after, a second real doctor is recruited, since the recruiting conversation itself will surface exactly which fields are needed.
- **No `subscription_packages` / `subscription_periods` / `package_eligible_doctors` tables** — all correctly scoped conceptually already (this audit's Part 4 stress test assumes this shape), none built. The physician's own instinct for a period-scoped entitlement snapshot (so a later price change never rewrites a past billing period) is the right design and should be implemented exactly as he described it, when the time comes.
- **No cancellation/no-show status** on `consultations` (Part 16) — a genuinely easy additive column + a few UI branches, but every day it's missing makes doctor-dashboard metrics and subscription accounting both slightly wrong.
- **No structured allergy/medication-history table** (Part 5/6/15) — currently would need to be re-asked every consultation via questionnaire; a persistent structured field on `family_members` would be a meaningful safety upgrade and is a small, additive change.
- **No support-ticket table** (Part 18) — small, additive, currently entirely absent.

**Nothing found in this audit requires a destructive schema change** — every gap listed above is additive (new tables or new nullable columns), consistent with the physician's own "modify, don't rebuild" instruction and this audit's Part 32 commitment to the same principle.

## Part 28 — Dashboard & visual design audit

Both the patient and doctor dashboards, as built, favor plain information hierarchy over visual flash — stat tiles, a clear status list, consistent typography — which is the right instinct for a healthcare product (Part 28 explicitly warns against flashy-at-the-expense-of-usable, and this build already errs correctly on the usable side). That said, assessed as a professional healthcare SaaS product rather than a functional prototype:

- **Empty states** are present but minimal (e.g., "No follow-ups scheduled yet") — functionally correct, could be more encouraging/actionable for a first-time user (Part 11).
- **Loading states** are consistent (a plain "Loading…" text) across every page inspected — functional, not polished, and consistent is more important than polished at this stage.
- **Error states** are consistently handled (every page inspected has a distinct, honest error branch rather than a silent failure) — this is a real strength or teams frequently get this wrong.
- **No charts/analytics visualizations exist anywhere** — appropriate for now (Part 21's "no complex analytics before validation" applies directly), but the executive-overview admin dashboard (Part 10), once built, will need at least simple time-series views (consultations/revenue over time) to be useful at all.
- **Mobile responsiveness** was not independently re-tested in this audit pass (Tailwind is in use throughout, which is a reasonable foundation) — worth a dedicated pass before public launch given that Pakistani patients overwhelmingly access services like this from a phone, not a desktop.
- **Navigation** is currently sparse by necessity (few pages exist) — this will need real information-architecture attention once doctor discovery, subscriptions, and an admin panel all exist simultaneously; not a problem yet, worth planning for now rather than retrofitting later.

## Part 29 — Red-team the business

Answering the specific adversarial questions posed, directly and without hedging where the evidence supports a clear answer:

- **What if patients don't trust AI?** Moot in the current build — there is no AI-driven decision a patient is being asked to trust (Part 13); the actual trust ask is "will a real doctor review this," which the architecture genuinely delivers on.
- **What if patients don't want online consultation?** Part 1's Pakistan-specific study found real, above-in-person satisfaction for telehealth generally — the risk is smaller than assumed, but privacy/security comfort was low (19.37% "extremely comfortable"), which argues for visible privacy/security messaging as a real acquisition lever, not just a compliance checkbox.
- **What if PKR 350/500 is too cheap to attract doctors, or too expensive for patients?** Part 20's unit economics show either price is comfortable on pure margin; the real doctor-attraction question is about a second doctor's *time* being worth more than the consultation fee net of any future commission split — unmodeled today because there is no commission model yet (Part 9), and this is worth resolving before actively recruiting a second doctor, not after.
- **What if doctors prefer Marham/Oladoc, or refuse a subscription model?** A real risk this audit cannot resolve with research alone — Part 1 found no data on doctor-side platform preference; worth a direct conversation with 2-3 real prospective doctors before building any doctor-facing commission/subscription-eligibility system.
- **What if subscription users consume all 8 consultations, or patients abuse the system?** This is Part 4's central finding — the real constraint is doctor capacity, not fraud; the closest thing to genuine abuse risk (multi-account subscription stacking, Part 4 scenario J/K) is real but low-scale today and should be named, not solved prematurely.
- **What if AI gives dangerous advice?** Cannot happen today in the diagnostic/prescribing path specifically, because there is no AI there (Part 5/6/13) — this specific fear is currently unfounded by construction, which is worth stating plainly rather than hedging.
- **What if Daily.co or the payment gateway fails?** Both have real, if incomplete, fallback behavior already (Part 16) — worth finishing the reconciliation/cancellation gaps identified there before this becomes a real-money problem.
- **What if a patient has an emergency during a video consultation, or a doctor makes a clinical error?** Both are protocol/training questions more than software questions at this scale (Part 5/6) — worth a short written internal protocol regardless of what's built in code.
- **What if a patient's medical record leaks?** No enacted Pakistani law currently defines breach obligations (Part 7) — but RLS and secrets hygiene are genuinely strong (Part 22), which reduces likelihood without eliminating the need for a response plan, which doesn't exist today.
- **What if we have subscribers but not enough doctors, or doctors but not enough patients?** The former is the single most quantified risk in this document (Part 4's capacity math); the latter is the acquisition question (Part 19) — both point to the same conclusion: **grow subscriptions and doctor headcount together, deliberately, never subscriptions ahead of confirmed doctor capacity.**
- **What if competitors copy the AI intake, or AI API costs rise?** Low near-term risk on both counts specifically because there is no AI intake yet to copy or to get expensive (Part 13) — revisit once one exists.
- **What if the business has high traffic but loses money?** Given Part 20/23's unit economics, this specific failure mode is unlikely to originate from consultation-level economics at either proposed price — it is far more likely to originate from marketing/acquisition spend outpacing patient lifetime value, which has not been modeled anywhere yet because no acquisition spend has happened.


## Part 30 — Final gap matrix

| Area | Current state | Gap | Severity | Business impact | Clinical/security impact | Recommended action |
|---|---|---|---|---|---|---|
| "AI-assisted" claim | Deterministic questionnaire, no LLM | Naming doesn't match reality | 🔴 Critical | Credibility risk with any technical due diligence | None — actually safer as-is | Rename honestly now; build real AI later as a scoped feature |
| Admin system | Does not exist | Every operational lever needs SQL | 🔴 Critical | Cannot operate beyond one physician doing everything by hand | Safety-event review has no UI at all | Build incrementally, starting with content-publishing + safety-event review |
| Multi-doctor architecture | Schema-ready, UI/data absent | No `doctors` table, no picker, no fee/specialty fields | 🔴 Critical | Blocks any growth beyond one physician | Blocks per-doctor eligible-package logic | Build before recruiting doctor #2 |
| Cancellation/no-show status | Absent | No status, no notification, no accounting | 🟠 High | Distorts metrics, blocks subscription slot logic | Patient left unclear if appointment happened | Add before launch |
| Payment reconciliation | Absent | No manual override if webhook silently fails | 🟠 High | Real money can get stuck in limbo | None directly, but real patient trust risk | Build a simple admin reconciliation view |
| Refund/support workflow | Absent | Safepay dashboard only; no complaint intake | 🟠 High | Matches incumbents' single biggest reputational failure mode | None directly | Build minimal support-ticket table + form before launch |
| Printable prescription | Absent | Web-view only | 🟠 High | Real-world usability gap (pharmacies expect paper/PDF) | Documentation completeness | Add PDF export |
| Allergy/interaction checking | Absent | No structured field, no interaction logic | 🟠 High | — | Real clinical-safety gap at scale (manageable solo, risky multi-doctor) | Add structured allergy field now; interaction DB later |
| Patient notifications | One email trigger only (safety events) | No booking/payment/prescription notice to patients | 🟠 High | Patients won't know to check the portal | — | Add prescription-ready + payment-status email now |
| Sindh telemedicine registration | Unresearched by the business | Possible practitioner registration/training requirement | 🟡 Medium | Regulatory exposure if serving Sindh patients | — | Confirm directly with a Sindh-based lawyer |
| Family-member cap enforcement | UI-only, not a hard DB constraint (unverified) | Possible subscription-loophole precursor | 🟡 Medium | Minor revenue leakage risk once subscriptions exist | — | Verify/add a hard constraint before subscriptions launch |
| Doctor payout/commission model | Does not exist | Moot with one doctor-owner | 🟡 Medium | Blocks any marketplace-style growth | — | Design once doctor #2 is being recruited |
| PMDC credential display | Does not exist | No trust signal shown | 🟡 Medium | Competitive disadvantage vs. incumbents on trust | — | Add once `doctors` table exists |
| Ratings/reviews | Does not exist | — | 🟢 Low | Possible patient expectation, not launch-blocking | — | Consider post-validation |
| Subscription system | Scoped, not built | Full feature absent | 🟢 Low (by design — correctly deferred) | Real future revenue line | Must ship with entitlement/renewal-failure states from day one | Build only after admin + doctor-capacity planning exist |
| Public Health Updates | Scoped, not built | Full feature absent | 🟢 Low | Non-load-bearing for core loop | Anti-fabrication rules must be enforced from day one if built | Defer until after core loop is validated |

## Part 31 — Final verdict

**Scores (0–100), assessed against this audit's own findings, not against an idealized platform:**

| Dimension | Score | Why |
|---|---|---|
| Product completeness | 45 | Core clinical loop is real and complete for one doctor; commercial/admin/ops layers are largely absent |
| Clinical safety | 78 | Genuinely strong deterministic design and provenance discipline; real gaps in allergy/interaction checking and prescription documentation completeness |
| Patient UX | 58 | Clear and honest for an active consultation; weak first-time-user orientation, no support/refund path |
| Doctor UX | 60 | Well-designed workspace and dashboard for one doctor; nothing exists for doctor-network operations |
| Admin capability | 5 | Does not exist |
| Business model | 40 | Pay-as-you-go economics are sound; subscription economics look good on paper but the real constraint (doctor capacity) is unaddressed |
| Unit economics | 70 | Margins are healthy at either proposed price once gateway/delivery costs are modeled correctly |
| Payments | 65 | Architecturally excellent (never-trust-client, server-verified); operationally unverified end-to-end, no refund/reconciliation tooling |
| Subscription model | 30 | Right shape conceptually, real unaddressed loopholes (no-show, renewal failure, capacity cap), nothing built |
| Security | 80 | RLS discipline, secrets hygiene, and server-side authorization are genuinely above first-build average |
| Scalability | 50 | Fine to ~1,000 users technically; doctor-capacity and admin-tooling gaps are the actual ceiling, not the tech stack |
| Competitive positioning | 35 | One real differentiator (family architecture) identified; "AI-assisted" claim currently doesn't hold up |
| Pakistan market readiness | 40 | Sound payment-gateway choice and Pakistan-specific research; regulatory landscape genuinely under-researched until this audit, and Sindh-specific exposure unresolved |
| Operational readiness | 20 | No support, no refunds, no cancellation handling, no admin tooling |
| Launch readiness | 35 | Could soft-launch to the physician's own existing patients today with manual workarounds for the gaps above; not ready for paid public marketing |

**CURRENT SCORE (unweighted average): ~47/100**
**ESTIMATED SCORE AFTER THE "MUST HAVE" FIXES IN PART 21:** ~68/100 — the remaining gap after that is almost entirely the admin/multi-doctor/subscription layer, which is genuinely a second phase of work, not a quick fix.

**Biggest 10 risks:** (1) selling subscriptions faster than doctor capacity grows; (2) claiming "AI-assisted" without AI; (3) no refund/complaint path when the first real complaint arrives; (4) Safepay webhook shape still unverified with real money on the line; (5) no cancellation/no-show handling distorting both metrics and patient trust; (6) Sindh's telemedicine-registration requirement, if it applies and goes unaddressed; (7) no allergy/interaction checking at higher volume or doctor count; (8) no admin system, meaning every operational fix routes through Claude/SQL indefinitely; (9) no doctor-payout model, blocking any real doctor-network growth; (10) no data-retention or breach-response plan, even though no law currently mandates one.

**Biggest 10 opportunities:** (1) the family-account architecture is a real, currently-unmatched differentiator; (2) incumbents' own reputational weaknesses (refunds, no-shows, unreliable listings) are a direct opening for a smaller, more reliable entrant; (3) a real (not claimed) AI-assisted layer built on top of the existing approved-question framework, later; (4) WhatsApp-first patient communication, matching how Pakistani patients actually communicate; (5) the deterministic safety engine as an honest trust signal once surfaced to patients; (6) a consultation-credit-pack as a simpler first commercial test than the full subscription; (7) the already-strong security architecture as a genuine talking point with any future partner/investor; (8) low fixed infrastructure cost ($45/month) means the business can validate cheaply before any real capital commitment; (9) the physician's own existing patient base as a zero-cost, high-trust acquisition channel; (10) Pakistan's currently unregulated telemedicine/AI landscape (Part 7) means there's real room to build ahead of regulation, provided it's done conservatively enough to adapt once rules do arrive (which the physician-review-everywhere design already positions well for).

**Top 10 things to fix before launch:** (1) resolve PKR 350 vs. 500; (2) stop calling the questionnaire "AI" in any patient-facing copy; (3) add cancellation/no-show status; (4) add a support/refund intake path; (5) add printable prescriptions; (6) add patient-facing prescription-ready/payment-status notifications; (7) finish Daily.co and Safepay end-to-end verification (already in progress); (8) confirm the Sindh registration question with a lawyer if serving Sindh patients; (9) add a structured allergy field; (10) write (even briefly) a data-retention and refund policy, even absent a legal requirement to do so.

### The direct answer

**If I were investing my own money into this platform today, after inspecting the code and researching the Pakistani market: YES, BUT.**

**Yes**, because the hard, easy-to-get-wrong parts — clinical safety architecture, payment security, family-account data isolation — are already built correctly, and that is usually where healthcare-tech first attempts fail. The unit economics work at either proposed consultation price. A real, underserved positioning (family-first, more reliable than the two documented-unreliable incumbents) exists and hasn't been disproven.

**But** not as currently scoped for the subscription launch specifically, and not with the current "AI-assisted" claim, and not without the operational layer (support, refunds, cancellations, notifications) that every one of the researched incumbents' worst reviews shows is exactly where healthcare-tech businesses actually lose patient trust — not the clinical product itself. **I would fund the pay-as-you-go, single-doctor, honestly-named version of this today, and treat the subscription business as a second raise/decision once doctor capacity and admin tooling both exist to support it responsibly.**

**What I'd change before spending more development time:** stop building new features (subscriptions, health updates) and spend the next block of work entirely on the Part 21 "must have" list — none of it is glamorous, all of it is what separates "a well-built clinical tool" from "a business a real patient can trust with a complaint."


## Part 32 — Preserving the existing project

Nothing in this audit's recommendations requires deleting, recreating, or restructuring what already works. Specifically:

- **Retain as-is:** patient/family accounts, the consultation lifecycle, the entire deterministic clinical-safety layer, the doctor clinical workspace and prescription lock-on-issue logic, the Daily.co and Safepay integrations (once verified), the RLS/security patterns throughout.
- **Modify (small, additive):** add a cancellation/no-show status to `consultations`; add a structured allergy field to `family_members`; add PDF export to the existing prescription view; resolve the PKR 350/500 fee constant.
- **Extend (new tables/pages, no rewrite):** a `doctors` table with public profile fields; a minimal admin panel starting with content-publishing and safety-event review; a support-ticket table; patient-facing notifications via the already-integrated Resend.
- **Deprecate:** nothing identified in this audit needs deprecating.
- **Rebuild:** nothing identified in this audit needs rebuilding.

## Part 33 — Development roadmap

**Phase 0 — Audit (this document).** Complete.

**Phase 1 — Launch blockers** (must exist before real patients pay real money): resolve the PKR 350/500 discrepancy; finish Daily.co + Safepay end-to-end verification (in progress); add cancellation/no-show status; add a minimal support/refund intake; add patient-facing prescription-ready/payment-status email notifications; add PDF prescription export; add a structured allergy field; confirm the Sindh registration question. Estimated complexity: small-to-medium per item, all additive to existing files — no new architectural pattern needed for any of them.

**Phase 2 — MVP for first real patients:** everything in Phase 1, plus a minimal admin view limited to safety-event review and clinical-content publishing (removes Claude/SQL as a dependency for the physician's own day-to-day operation); a basic reconciliation view for payments; stop describing the questionnaire as "AI" anywhere patient-facing.

**Phase 3 — Validation (first 100–500 patients):** measure, don't guess: actual consultation completion rate, actual no-show rate, actual support-ticket volume/type, actual doctor-hours consumed per patient per month, actual willingness to pre-pay for a consultation-credit pack (a cheap test of subscription appetite before building the full family-plan). Acquisition channel: the physician's own existing patients + WhatsApp, nothing paid yet.

**Phase 4 — Scale (only once Phase 3 data supports it):** the `doctors` table and a real doctor-onboarding/commission model, built *before* actively recruiting doctor #2, not after; the Family Care Plan subscription, built with the entitlement/renewal-failure states this audit specifies, capped to what doctor capacity can actually serve; the fuller admin control center (Part 10); WhatsApp notifications; Public Health Updates; ratings/reviews; PMDC credential display.

---

## Appendix — full unit-economics tables

*(Referenced from Part 4/20. Assumptions: Safepay confirmed fee schedule, 40% card/60% wallet mix, 60/25/15% text/audio/video delivery mix, Daily.co confirmed per-minute rates, 12-minute average call, PKR 285/USD planning rate — all ASSUMPTION where marked, all rates otherwise FACT per the cited research above.)*

### Pay-as-you-go: net revenue per month (before doctor time/payout, before fixed hosting), PKR 350 fee

| Doctors ↓ / Consults per day → | 10 | 20 | 30 | 50 | 100 |
|---|---|---|---|---|---|
| 1 | 97,498 | 194,996 | 292,494 | 487,490 | 974,979 |
| 5 | 487,490 | 974,979 | 1,462,469 | 2,437,448 | 4,874,896 |
| 10 | 974,979 | 1,949,959 | 2,924,938 | 4,874,896 | 9,749,793 |
| 25 | 2,437,448 | 4,874,896 | 7,312,345 | 12,187,241 | 24,374,483 |
| 50 | 4,874,896 | 9,749,793 | 14,624,690 | 24,374,483 | 48,748,965 |

### Pay-as-you-go: net revenue per month, PKR 500 fee

| Doctors ↓ / Consults per day → | 10 | 20 | 30 | 50 | 100 |
|---|---|---|---|---|---|
| 1 | 141,571 | 283,142 | 424,713 | 707,855 | 1,415,709 |
| 5 | 707,855 | 1,415,709 | 2,123,564 | 3,539,273 | 7,078,546 |
| 10 | 1,415,709 | 2,831,419 | 4,247,128 | 7,078,546 | 14,157,093 |
| 25 | 3,539,273 | 7,078,546 | 10,617,820 | 17,696,366 | 35,392,732 |
| 50 | 7,078,546 | 14,157,093 | 21,235,640 | 35,392,732 | 70,785,465 |

### Subscription (PKR 2,000/mo, 3 members, 8 consults): gross margin by subscriber count and utilization

| Subscribers ↓ / Utilization → | 25% | 50% | 75% | 100% |
|---|---|---|---|---|
| 100 | 193,521 | 192,361 | 191,202 | 190,042 |
| 500 | 967,603 | 961,806 | 956,009 | 950,212 |
| 1,000 | 1,935,206 | 1,923,612 | 1,912,019 | 1,900,425 |
| 5,000 | 9,676,031 | 9,618,062 | 9,560,093 | 9,502,124 |
| 10,000 | 19,352,062 | 19,236,124 | 19,120,186 | 19,004,248 |

*Reminder: these margins are calculated against server/gateway costs only. They do not subtract the doctor-hours actually consumed — the real constraint, per Part 4. Doctor-capacity requirement at 100% utilization: ~0.9 doctors per 100 subscribers, scaling linearly (e.g., ~44 doctors for 5,000 subscribers, ~89 for 10,000), at an assumed 30 consultations/doctor/day.*

---

*End of audit. Per the working rule established for this project, no implementation begins until the physician reviews this document and directs which part of the roadmap to start with.*
