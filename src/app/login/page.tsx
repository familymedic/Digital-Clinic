"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";

type Errors = Partial<Record<"email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email address.";
    }
    if (password.length === 0) {
      next.password = "Please enter your password.";
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
        <PageHeader title="Log in" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 text-sm text-teal-900">
            <p className="font-semibold">This form works correctly.</p>
            <p className="mt-2 leading-relaxed">
              Real accounts and login aren&rsquo;t connected yet — that
              arrives in Phase 3, once the database is built. Nothing you
              entered was saved or sent anywhere.
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
      <PageHeader title="Log in" />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            Log in
          </button>

          <p className="text-center text-sm text-slate-500">
            New patient?{" "}
            <Link href="/register" className="font-medium text-teal-700 underline underline-offset-2">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
