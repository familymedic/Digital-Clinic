"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { GUEST_ACCESS_DAYS } from "@/lib/quickBooking";

// "Find my appointment" - the way back for someone who booked without
// registering and no longer has their saved link: mobile number + the PIN
// they chose after paying. See /api/access/find for the safety rules.
export default function FindAppointment() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Please enter the mobile number you booked with.");
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Please enter your PIN (4 to 6 digits).");
      return;
    }
    if (!isDatabaseConfigured || !supabase) {
      setError("The database isn't connected yet.");
      return;
    }
    setSubmitting(true);
    const result = await apiFetch<{ email?: string; password?: string; next?: string; error?: string }>(
      "/api/access/find",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin }),
      }
    );
    const data = result.data;
    if (!result.ok || !data?.email || !data?.password) {
      setError(result.error ?? data?.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (signInError) {
      setError("We couldn't open your appointment. Please try again.");
      setSubmitting(false);
      return;
    }
    router.replace(data.next ?? "/dashboard");
  }

  return (
    <div>
      <PageHeader
        title="Find my appointment"
        subtitle="Booked without creating an account? Enter your mobile number and PIN to get back to your appointment and prescription."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-8"
        >
          <FormField
            label="Mobile number"
            name="findPhone"
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="0300 1234567"
            autoComplete="tel"
            required
          />
          <div>
            <label htmlFor="findPin" className="block text-sm font-medium text-ink-700">
              Your PIN<span className="text-teal-700"> *</span>
            </label>
            <input
              id="findPin"
              name="findPin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="mt-1.5 block w-full rounded-md border border-[#d7e7e2] px-3 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
            <p className="mt-1 text-xs text-ink-500">The 4 to 6 digit PIN you chose after paying.</p>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Looking…" : "Find my appointment"}
          </button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-ink-500">
          <p>
            You can open your appointment for {GUEST_ACCESS_DAYS} days after it ends. Please download your
            prescription before then.
          </p>
          <p>
            Have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
          <p>
            Forgot your PIN? Open the appointment link you saved &mdash; once you&rsquo;re in, choose a new PIN on
            your dashboard. No link? Please{" "}
            <Link href="/contact" className="font-medium text-teal-700 underline underline-offset-2">
              contact us
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
