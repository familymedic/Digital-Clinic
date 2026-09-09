"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";

type Errors = Partial<Record<"fullName" | "email" | "phone" | "password" | "confirmPassword" | "agreeTerms", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,15}$/;

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (fullName.trim().length < 2) {
      next.fullName = "Please enter your full name.";
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email address.";
    }
    if (phone.trim() && !PHONE_RE.test(phone.trim())) {
      next.phone = "Please enter a valid phone number, or leave this blank.";
    }
    if (password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    }
    if (confirmPassword !== password) {
      next.confirmPassword = "Passwords don't match.";
    }
    if (!agreeTerms) {
      next.agreeTerms = "Please agree to the Terms and Privacy Policy to continue.";
    }
    return next;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) {
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div>
        <PageHeader title="Create your account" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-semibold">Thanks, {fullName.split(" ")[0]} — this looks good.</p>
            <p className="mt-2 leading-relaxed">
              Real account creation isn&rsquo;t connected yet — that arrives
              in Phase 3, once the database is built. Nothing you entered
              was saved or sent anywhere. This screen is just to confirm the
              form itself works correctly.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-semibold text-teal-800 underline underline-offset-2"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Create your account"
        subtitle="Just enough information to book and manage your consultations."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <FormField
            label="Full name"
            name="fullName"
            value={fullName}
            onChange={setFullName}
            error={errors.fullName}
            placeholder="e.g. Ahmed Khan"
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
            label="Phone number"
            name="phone"
            type="tel"
            value={phone}
            onChange={setPhone}
            error={errors.phone}
            placeholder="+92 3XX XXXXXXX"
            autoComplete="tel"
            hint="Optional for now — used later for appointment reminders."
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
            <label className="flex items-start gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
              />
              <span>
                I agree to the{" "}
                <Link href="/terms" className="font-medium text-teal-700 underline underline-offset-2">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="font-medium text-teal-700 underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {errors.agreeTerms && (
              <p className="mt-1 text-xs font-medium text-red-600">{errors.agreeTerms}</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Create account
          </button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
