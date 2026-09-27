// Physician Engagement Agreement — the actual click-to-agree text
// (2026-09-26). Until today, /doctor/register only had a passive note
// ("a terms-of-engagement agreement applies... details will be shared
// with you at that point") with no real consent text or checkbox
// anywhere — this file is the first version doctors are actually shown
// and asked to accept, per the physician's own instruction: "make it
// official... doctors can tick I agree."
//
// Not lawyer-reviewed in full. Section 16 (Limitation of Liability) in
// particular is an interim, conservative version written to fill a
// section that was previously left completely blank — the physician
// chose this over waiting for lawyer review, given the need to onboard
// doctors starting today (see the "interim clause" option, chosen
// 2026-09-26). Business terms not covered by a bracket below were
// confirmed directly with the physician: 15-day termination notice
// (not the earlier placeholder's suggested 30), non-exclusive (a
// doctor may practice/consult elsewhere), and Karachi, Pakistan courts
// for any dispute.
//
// ENGAGEMENT_AGREEMENT_VERSION is a plain tag, not a database foreign
// key — bump it whenever the text below changes, and every doctor
// (new or already-approved) who only has an acceptance row for an
// older version will see the agreement gate again (DoctorShell.tsx's
// useDoctorAgreementGate) until they accept the new one. Do not edit
// this file's text without also bumping the version — an unbumped
// edit would silently change what past acceptances legally cover.
//
// Revised 2026-09-27, physician's own instruction: a doctor signing
// this should see the agreement itself, not commentary about its own
// drafting/review status directed at the physician. Removed the
// on-screen "not yet reviewed by a lawyer" banner and the matching
// sentences inside Sections 12 and 16 — this is a visible-text change
// (nothing in Sections 7/8/10/14/16(a-d)'s actual substance changed),
// so the version is bumped and every doctor, including the 3 already
// approved, will be asked to accept again next time they load their
// dashboard. Internally, for the physician's own tracking: Section 16
// is still an interim clause no lawyer has reviewed yet — that fact
// hasn't changed, it's just no longer narrated to doctors in the text
// itself. Worth still getting real legal review before this is relied
// on in an actual dispute.
export const ENGAGEMENT_AGREEMENT_VERSION = "2026-09-27-v2";

// One open item, flagged rather than guessed: the physician's own
// full legal name (as a sole proprietor) isn't recorded anywhere in
// this project. Rather than invent one or leave a raw "[bracket]"
// visible in a document doctors are asked to sign, "the Platform" is
// defined below by its trade name, with the proprietor's legal
// identity described as on file — accurate, but the physician should
// confirm whether he'd rather have his exact legal name printed
// directly in Section 1 (generally the stronger, more enforceable
// choice for a sole proprietorship). Swapping it in later is a
// one-line change to this string, no new consent needed since it's a
// factual correction, not a change to any term a doctor is agreeing to.
export const PLATFORM_LEGAL_DESCRIPTION =
  "Family Medic (Digital Family Clinic), a sole proprietorship operated by the Platform's administrator, whose full legal name and CNIC are on file with the Platform and available to the Physician on request";

export const ENGAGEMENT_AGREEMENT_TITLE = "Physician Engagement Agreement";

// Rendered as plain paragraphs (register page + agreement gate both
// split on "\n\n" and treat a line starting with a number+"." as a
// heading) — deliberately not JSX/HTML here, so the exact same text
// can also be pasted into a plain-text or Word copy for the physician's
// own records without re-deriving it from component markup.
export const ENGAGEMENT_AGREEMENT_TEXT = `
1. Parties
This Agreement is between ${PLATFORM_LEGAL_DESCRIPTION} ("the Platform") and the physician identified in the Platform's doctor application/account for which this Agreement is being accepted, holder of the PMDC registration number on file with that application ("the Physician") — together, "the Parties."

2. Background
The Platform operates an online service through which patients book and pay for medical consultations with independent, PMDC-verified physicians, delivered by video, audio, or text. The Platform provides the booking, payment, and record-keeping technology; it does not provide medical advice, diagnosis, or treatment itself, and does not employ the Physician. The Physician wishes to offer consultations to patients through the Platform on the terms below.

3. Term
This Agreement begins on the date the Physician accepts it and continues with no fixed end date, until terminated by either Party under Section 14.

4. Independent Contractor Status
The Physician provides consultations as an independent contractor, not as an employee, agent, or partner of the Platform. The Physician is responsible for their own income tax, professional licensing fees, and any staff or equipment they use. Nothing in this Agreement creates an employment relationship or entitles the Physician to any employee benefit. The Physician is not exclusive to the Platform and may continue to practice, consult, or be listed with other platforms or their own clinic while engaged here (see Section 13).

5. Professional Credentials and Verification
The Physician represents that they hold a current, valid PMDC registration under the number provided at application, and that the certificate submitted at registration is genuine and unaltered. The Physician must notify the Platform in writing within 3 business days if their PMDC registration is suspended, revoked, lapses, or becomes subject to any disciplinary proceeding. The Platform may suspend the Physician's access immediately, without prior notice, if it has reasonable grounds to believe the Physician's registration is no longer valid (Section 14).

6. Scope of Services
The Physician will provide medical consultations to patients booked through the Platform, by the delivery method the patient selects (video, audio, or text), within the specialty/department the Physician registered under. The Physician sets their own consultation fee, subject to Section 7, and may update it from time to time through the Platform, subject to the same approval rules applying to any new fee.

7. Consultation Fees and Platform Share
The Physician's consultation fee must be at least PKR 500. The Platform's share of each consultation fee is set by the fee actually charged: PKR 150 for a fee of PKR 500–900; PKR 200 for PKR 901–1,200; PKR 250 for PKR 1,201–1,500. A fee above PKR 1,500 requires the Platform administrator's separate, explicit approval before it may be charged to any patient; the exact platform share for such a fee is set by the administrator at approval time and confirmed to the Physician in writing before it takes effect. A consultation the Physician waives (e.g. a free follow-up) earns the Physician their full share as if the standard fee had been charged — the Platform absorbs that visit's cost, not the Physician. A refunded consultation earns the Physician nothing for that visit.

8. Platform Subscription Fee
The Physician pays the Platform a subscription fee of PKR 5,000 per month to remain listed and able to accept bookings, currently collected by bank transfer or JazzCash and recorded by the administrator once payment proof is reviewed. The Physician's access to the consultation queue, availability calendar, and profile locks automatically the moment the paid period ends, and unlocks again automatically once the administrator confirms the next payment — there is no separate grace period beyond the period the Physician already paid for.

9. Payment Settlement
The Physician's share of consultation fees (Section 7) is settled periodically, based on consultations that reached a completed status during that period, less any refunded consultations. Payout amounts are generated by the administrator and paid by bank transfer or another method agreed with the administrator, to the account the Physician provides. The Physician can view their own payout history through their dashboard.

10. Clinical Responsibility
The Physician is solely and fully responsible for every clinical decision made for a patient consulted through the Platform — diagnosis, treatment, prescriptions, and any advice given. The Platform's technology (including any guided-history questionnaire) is assistive only. It never makes a diagnosis, never issues a prescription, and never substitutes for the Physician's own independent clinical judgment. The Physician is responsible for judging, for each individual patient, whether a remote consultation (video, audio, or text) is clinically appropriate at all, and for directing the patient to in-person or emergency care whenever it is not — including, without limitation, any presentation of chest pain, shortness of breath, or another emergency warning sign, regardless of what the patient selected when booking. The Physician maintains their own clinical records in line with PMDC's professional requirements, in addition to what is recorded on the Platform.

11. Confidentiality and Patient Data
The Physician will keep all patient information encountered through the Platform confidential, consistent with ordinary physician-patient confidentiality obligations, and will not use it for any purpose outside providing the consultation itself. The Physician will not download, copy, or export patient data from the Platform except as reasonably needed for their own clinical recordkeeping. Pakistan currently has no enacted general data-protection law; this clause is based on ordinary professional confidentiality duties rather than a specific statute.

12. Professional Conduct and Regulatory Compliance
The Physician will comply with all PMDC codes of conduct and any law applicable to their practice, including any telemedicine-specific registration or training requirement that may apply — for example, the Sindh Telemedicine and Telehealth Act, 2021 has been reported (though not independently confirmed against the primary legal text) to require practitioner registration before offering telehealth to patients located in Sindh. The Physician will not prescribe any medication outside what PMDC and applicable law permit to be prescribed via a remote consultation.

13. Non-Exclusivity
The Physician is not exclusive to the Platform. The Physician may continue to practice, consult, or be listed with other telemedicine platforms or their own clinic at the same time as being engaged here.

14. Suspension and Termination
The Platform may suspend or deactivate the Physician's account, with or without prior notice depending on severity, for: the Physician's PMDC registration lapsing, being suspended, or being revoked; non-payment of the monthly subscription fee (Section 8); a pattern of patient complaints or safety events, at the administrator's reasonable discretion; or any breach of this Agreement, PMDC's code of conduct, or applicable law. Either Party may otherwise terminate this Agreement for any reason with 15 days' written notice. On termination, the Physician's final payout is settled for all consultations completed before the termination date.

15. Intellectual Property and Branding
The Platform's name, logo, and branding remain the Platform's property. The Physician may not use them outside the Platform without written permission. Any content the Platform provides the Physician for use on their profile remains the Platform's property.

16. Limitation of Liability
(a) The Platform provides technology only — booking, payment processing, video/audio/text infrastructure, and administrative record-keeping. The Platform is not a healthcare provider, does not practice medicine, and makes no clinical decision of any kind.
(b) The Physician is solely and fully responsible for every clinical decision, diagnosis, treatment, prescription, and piece of medical advice given to a patient through the Platform, and carries their own professional and malpractice liability for all of it, independent of anything the Platform does or does not do.
(c) To the fullest extent permitted by applicable law, the Platform's total liability to the Physician arising out of or in connection with this Agreement, however caused, is limited to the platform subscription fees actually paid by the Physician in the three (3) months before the event giving rise to the claim. The Platform is not liable to the Physician for any indirect, incidental, or consequential loss, including lost income from a specific consultation or patient.
(d) Nothing in this clause limits or excludes liability that cannot lawfully be limited or excluded under the law of Pakistan, including liability arising from fraud or wilful misconduct.

17. Dispute Resolution and Governing Law
This Agreement is governed by the laws of Pakistan. Any dispute will first be raised directly between the Parties in good faith; if not resolved within 30 days, either Party may bring it before the courts of Karachi, Pakistan, which have exclusive jurisdiction.

18. Amendment
The Platform may update the fee tiers in Section 7, the subscription fee in Section 8, the Limitation of Liability in Section 16, or other operational terms from time to time, with 15 days' written notice to the Physician before the change takes effect. Continuing to accept new bookings after that date is treated as acceptance of the updated terms; for a material change, the Platform may instead require a fresh, explicit acceptance (the same click-to-agree step used today) before the Physician can continue.

19. Entire Agreement
This Agreement, together with any Platform policy it refers to, is the entire agreement between the Parties regarding the Physician's engagement and supersedes any earlier discussion or understanding on the same subject.

20. Acceptance
By checking "I have read and agree to the Physician Engagement Agreement" and submitting the application, the Physician accepts this Agreement (version ${ENGAGEMENT_AGREEMENT_VERSION}) electronically. The Platform records the Physician's account, this version, and the exact date and time of acceptance as its record of that agreement.
`.trim();
