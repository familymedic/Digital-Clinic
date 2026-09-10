"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AddFamilyMemberForm from "@/components/AddFamilyMemberForm";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";

interface Consultation {
  id: string;
  complaint: string;
  status: string;
  created_at: string;
  patient: { full_name: string } | { full_name: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted — awaiting next steps",
};

function consultationPatientName(c: Consultation): string {
  if (!c.patient) return "";
  return Array.isArray(c.patient) ? c.patient[0]?.full_name ?? "" : c.patient.full_name;
}

export default function Dashboard() {
  const { session, loading } = useAuth();
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("consultations")
      .select("id, complaint, status, created_at, patient:family_members(full_name)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setFetchError(error.message);
        } else {
          setConsultations(data as Consultation[]);
        }
      });
  }, [session]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="My Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s no
            account system to show a dashboard for.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="My Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="My Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>You need to log in to see your dashboard.</p>
            <Link
              href="/login"
              className="mt-3 inline-block font-medium text-teal-700 underline underline-offset-2"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const firstName = session.user.user_metadata?.full_name?.split(" ")?.[0] || "there";

  return (
    <div>
      <PageHeader title={`Hello, ${firstName}`} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Family members
            </h2>
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="text-sm font-medium text-teal-700 underline underline-offset-2"
              >
                + Add family member
              </button>
            )}
          </div>

          {familyError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load family members: {familyError}
            </div>
          )}

          {!familyError && familyMembers === null && (
            <p className="mt-4 text-sm text-slate-400">Loading…</p>
          )}

          {!familyError && familyMembers && familyMembers.length > 0 && (
            <ul className="mt-4 space-y-2">
              {familyMembers.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                >
                  <span className="text-sm font-medium text-slate-900">{m.full_name}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {showAddForm && (
            <div className="mt-4">
              <AddFamilyMemberForm
                onAdded={(member) => {
                  setFamilyMembers((prev) => [...(prev ?? []), member]);
                  setShowAddForm(false);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            Everyone listed here can have consultations booked for them from
            this account — no separate login needed for family members you
            add yourself.
          </p>
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your consultations
            </h2>
            <Link
              href="/book"
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              Book a consultation
            </Link>
          </div>

          {fetchError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load your consultations: {fetchError}
            </div>
          )}

          {!fetchError && consultations === null && (
            <p className="mt-6 text-sm text-slate-400">Loading your consultations…</p>
          )}

          {!fetchError && consultations?.length === 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No consultations yet. Booking one is the next step.
            </div>
          )}

          {!fetchError && consultations && consultations.length > 0 && (
            <ul className="mt-6 space-y-3">
              {consultations.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{c.complaint}</p>
                      {consultationPatientName(c) && (
                        <p className="text-xs text-slate-400">
                          For: {consultationPatientName(c)}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-xs text-slate-400">
          This is an early version of your dashboard. History-taking, doctor
          review, video visits, and prescriptions are built in later
          phases — right now a booked consultation is recorded, not yet
          actioned by a doctor.
        </p>
      </div>
    </div>
  );
}
