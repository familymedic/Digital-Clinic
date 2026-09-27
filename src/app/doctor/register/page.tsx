"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import EngagementAgreementText from "@/components/EngagementAgreementText";
import { isDatabaseConfigured } from "@/lib/supabaseClient";
import { SPECIALTIES } from "@/lib/specialties";
import { MIN_DOCTOR_CONSULTATION_FEE } from "@/lib/platformFee";
import { ENGAGEMENT_AGREEMENT_VERSION } from "@/lib/engagementAgreement";

// Doctor onboarding, step 1 (2026-09-14): a real self-service "apply to
// join" page, replacing admin-invite-only onboarding (0026) as the way
// most new doctors join — the physician's own stated problem was having
// five doctors lined up and no way to bring them on without sharing a
// login link by hand each time. Submitting here does not create a live,
// bookable doctor: it creates a pending_review application that only an
// admin can approve (src/app/admin/doctors/page.tsx), after checking the
// PMDC number and certificate.
//
// Doctor onboarding, step 7 (2026-09-26): the actual terms-of-engagement
// text is now here — see src/lib/engagementAgreement.ts. A checkbox
// below is required to submit; the server (src/app/api/doctors/
// register/route.ts) independently re-checks it and records an
// immutable acceptance row (doctor_agreement_acceptances, 0047) rather
// than trusting the client's checkbox state alone, the same "never
// trust the client for anything that gates access" principle already
// used for verification_status/is_active on this same route.
//
// Still deliberately NOT here yet: the PKR 5,000/month subscription
// payment itself (billing mechanism decided since — bank transfer/
// JazzCash, see DoctorShell.tsx — but not collected at this step; it's
// requested after approval, same as before).

type Errors = Partial<
  Record<
    "fullName" | "email" | "password" | "confirmPassword" | "specialty" | "pmdcNumber" | "consultationFee" | "certificate" | "agreement",
    string
  >
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DoctorRegister() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [pmdcNumber, setPmdcNumber] = useState("");
  const [consultationFee, setConsultationFee] = useState(String(MIN_DOCTOR_CONSULTATION_FEE));
  const [certificate, setCertificate] = useState<File | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (fullName.trim().length < 2) next.fullName = "Please enter your full name.";
    if (!EMAIL_RE.test(email.trim())) next.email = "Please enter a valid email address.";
    if (password.length < 8) next.password = "Password must be at least 8 characters.";
    if (confirmPassword !== password) next.confirmPassword = "Passwords don't match.";
    if (!specialty) next.specialty = "Please choose your specialty.";
    if (pmdcNumber.trim().length < 3) next.pmdcNumber = "Please enter your PMDC registration number.";
    const fee = Number(consultationFee);
    if (!Number.isFinite(fee) || fee < MIN_DOCTOR_CONSULTATION_FEE) {
      next.consultationFee = `Must be at least PKR ${MIN_DOCTOR_CONSULTATION_FEE}.`;
    }
    if (!certificate) next.certificate = "Please attach your scanned PMDC certificate.";
    if (!agreementAccepted) next.agreement = "Please read and agree to the Physician Engagement Agreement to continue.";
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!isDatabaseConfigured) {
      setServerError("The database isn't connected yet — this form is fully built, but can't submit for real yet.");
      return;
    }

    setSubmitting(true);
    setServerError(null);

    const body = new FormData();
    body.set("fullName", fullName.trim());
    body.set("email", email.trim());
    body.set("password", password);
    body.set("specialty", specialty);
    body.set("pmdcNumber", pmdcNumber.trim());
    body.set("consultationFee", consultationFee);
    if (certificate) body.set("certificate", certificate);
    body.set("agreementAccepted", "true");
    body.set("agreementVersion", ENGAGEMENT_AGREEMENT_VERSION);

    const res = await fetch("/api/doctors/register", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setServerError(data.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div>
        <PageHeader title="Apply to join as a doctor" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-semibold">Application received, {fullName.split(" ")[0]}.</p>
            <p className="mt-2 leading-relaxed">
              We&rsquo;ll review your PMDC certificate and get back to you. Once approved, you can log in at the
              doctor login page below — until then, logging in will show your application as under review.
            </p>
            <Link
              href="/doctor/login"
              className="mt-4 inline-block text-sm font-semibold text-teal-800 underline underline-offset-2"
            >
              Go to doctor log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Apply to join as a doctor"
        subtitle="PMDC-verified physicians can join and set their own consultation fee."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {serverError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Couldn&rsquo;t submit your application.</p>
            <p className="mt-1 leading-relaxed">{serverError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <FormField
            label="Full name"
            name="fullName"
            value={fullName}
            onChange={setFullName}
            error={errors.fullName}
            placeholder="e.g. Dr. Ayesha Malik"
            autoComplete="name"
            required
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            error={errors.email}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            autoComplete="new-password"
            hint="At least 8 characters."
            required
          />
          <FormField
            label="Confirm password"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={errors.confirmPassword}
            autoComplete="new-password"
            required
          />

          <div>
            <label htmlFor="specialty" className="block text-sm font-medium text-slate-700">
              Specialty <span className="text-teal-700">*</span>
            </label>
            <select
              id="specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className={`mt-1.5 block w-full rounded-md border px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:ring-2 ${
                errors.specialty
                  ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                  : "border-slate-300 focus:border-teal-600 focus:ring-teal-100"
              }`}
            >
              <option value="">Select a specialty…</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {errors.specialty && <p className="mt-1 text-xs font-medium text-red-600">{errors.specialty}</p>}
          </div>

          <FormField
            label="PMDC registration number"
            name="pmdcNumber"
            value={pmdcNumber}
            onChange={setPmdcNumber}
            error={errors.pmdcNumber}
            placeholder="e.g. 12345-F"
            required
          />

          <FormField
            label="Your consultation fee (PKR)"
            name="consultationFee"
            type="number"
            value={consultationFee}
            onChange={setConsultationFee}
            error={errors.consultationFee}
            hint={`Minimum PKR ${MIN_DOCTOR_CONSULTATION_FEE}. Fees above PKR 1,500 need a separate admin approval before going live.`}
            required
          />

          <div>
            <label htmlFor="certificate" className="block text-sm font-medium text-slate-700">
              Scanned PMDC certificate <span className="text-teal-700">*</span>
            </label>
            <input
              id="certificate"
              name="certificate"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setCertificate(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-teal-700 hover:file:bg-teal-100"
            />
            <p className="mt-1 text-xs text-slate-400">JPG, PNG, WEBP, or PDF — up to 8MB.</p>
            {errors.certificate && <p className="mt-1 text-xs font-medium text-red-600">{errors.certificate}</p>}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            A monthly platform subscription fee (PKR 5,000) applies once your application is approved — payment
            details will be shared with you at that point, before anything is charged.
          </div>

          <div>
            <label htmlFor="agreement" className="block text-sm font-medium text-slate-700">
              Physician Engagement Agreement <span className="text-teal-700">*</span>
            </label>
            <p className="mt-1 text-xs text-slate-500">Please read the full agreement before agreeing below.</p>
            <div className="mt-2">
              <EngagementAgreementText />
            </div>
            <label className="mt-3 flex items-start gap-2.5 text-sm text-slate-700">
              <input
                id="agreement"
                type="checkbox"
                checked={agreementAccepted}
                onChange={(e) => setAgreementAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
              />
              <span>
                I have read and agree to the Physician Engagement Agreement (version {ENGAGEMENT_AGREEMENT_VERSION}).
              </span>
            </label>
            {errors.agreement && <p className="mt-1 text-xs font-medium text-red-600">{errors.agreement}</p>}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit application"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Already approved?{" "}
            <Link href="/doctor/login" className="font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
