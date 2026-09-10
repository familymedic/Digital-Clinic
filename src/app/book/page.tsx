"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AddFamilyMemberForm from "@/components/AddFamilyMemberForm";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";

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
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("family_members")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setFamilyError(error.message);
        } else {
          setFamilyMembers(data as FamilyMember[]);
        }
      });
  }, [session]);

  async function bookComplaint(complaint: string) {
    if (!supabase || !session || !selectedMember) return;
    setSubmittingFor(complaint);
    setError(null);

    const { error: insertError } = await supabase.from("consultations").insert({
      patient_id: selectedMember.id,
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

  // Step 1: who is this consultation for?
  if (!selectedMember) {
    return (
      <div>
        <PageHeader
          title="Book a consultation"
          subtitle="First, who is this visit for?"
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {familyError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load family members: {familyError}
            </div>
          )}

          {!familyError && familyMembers === null && (
            <p className="text-sm text-slate-400">Loading…</p>
          )}

          {!familyError && familyMembers && familyMembers.length > 0 && (
            <div className="space-y-2">
              {familyMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMember(m)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-teal-600"
                >
                  <span className="text-sm font-medium text-slate-900">{m.full_name}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              + Someone else in your family
            </button>
          )}

          {showAddForm && (
            <div className="mt-4">
              <AddFamilyMemberForm
                onAdded={(member) => {
                  setFamilyMembers((prev) => [...(prev ?? []), member]);
                  setShowAddForm(false);
                  setSelectedMember(member);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 2: what's the complaint?
  return (
    <div>
      <PageHeader
        title="Book a consultation"
        subtitle="Payment and scheduling are added in later phases — for now this records your request."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <span>
            Booking for <span className="font-semibold">{selectedMember.full_name}</span>
          </span>
          <button
            onClick={() => setSelectedMember(null)}
            className="text-xs font-medium underline underline-offset-2"
          >
            Change
          </button>
        </div>

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
