"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

const complaints = [
  "Fever",
  "Cough",
  "Sore throat",
  "Abdominal pain",
  "Diarrhea / vomiting",
  "Headache",
  "Back pain",
  "Urinary symptoms",
  "Shortness of breath",
  "Chest pain",
  "Other",
];

export default function Book() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function bookComplaint(complaint: string) {
    if (!supabase || !session) return;
    setSubmittingFor(complaint);
    setError(null);

    const { error: insertError } = await supabase.from("consultations").insert({
      patient_id: session.user.id,
      complaint,
    });

    setSubmittingFor(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.push("/dashboard");
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so bookings can&rsquo;t
            be saved. This page will work once a Supabase project is
            connected.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in or create an account first to book a consultation.</p>
            <div className="mt-4 flex gap-4">
              <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
                Log in
              </Link>
              <Link href="/register" className="font-medium text-teal-700 underline underline-offset-2">
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Book a consultation"
        subtitle="Choose the reason for your visit. Payment and scheduling are added in later phases — for now this records your request."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t book that: {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {complaints.map((c) => (
            <button
              key={c}
              onClick={() => bookComplaint(c)}
              disabled={submittingFor !== null}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              {submittingFor === c ? "Booking…" : c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
