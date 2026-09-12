"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 7 — the Dashboard (Section 13/14): a summary/overview landing
// page, separate from the full list (/doctor/queue). "Today's
// consultations, completed/waiting/follow-ups, safety alerts, basic
// activity info" per Section 14 — revenue is left out for now since
// there's no payment collection at all yet (Phase 10). Follow-ups are
// grouped Today/Tomorrow/Later/Overdue exactly as Section 16 called for.

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
  is_flagged: boolean;
  created_at: string;
  patient: { full_name: string } | { full_name: string }[] | null;
}

interface FollowUpRow {
  follow_up_date: string;
  follow_up_reason: string | null;
  consultation:
    | { id: string; complaint: string; patient: { full_name: string } | { full_name: string }[] | null }
    | { id: string; complaint: string; patient: { full_name: string } | { full_name: string }[] | null }[]
    | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function patientName(p: { full_name: string } | { full_name: string }[] | null): string {
  const one_ = one(p);
  return one_?.full_name ?? "Unknown patient";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function DoctorDashboard() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();
  const [consultations, setConsultations] = useState<ConsultationRow[] | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase || !profile) return;

    Promise.all([
      supabase
        .from("consultations")
        .select("id, complaint, status, is_flagged, created_at, patient:family_members(full_name)"),
      supabase
        .from("consultation_assessments")
        .select(
          "follow_up_date, follow_up_reason, consultation:consultations(id, complaint, patient:family_members(full_name))"
        )
        .eq("status", "issued")
        .not("follow_up_date", "is", null),
    ]).then(([consultationsRes, followUpsRes]) => {
      if (consultationsRes.error) {
        setLoadError(consultationsRes.error.message);
      } else {
        setConsultations(consultationsRes.data as ConsultationRow[]);
      }
      if (followUpsRes.error) {
        setLoadError((prev) => prev ?? followUpsRes.error!.message);
      } else {
        setFollowUps(followUpsRes.data as FollowUpRow[]);
      }
    });
  }, [session, profile]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in with your doctor account first.</p>
            <Link href="/doctor/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t verify your doctor account: {profileError}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as a doctor account.</p>
            <div className="mt-4 flex gap-4">
              <button onClick={() => signOut()} className="font-medium text-teal-700 underline underline-offset-2">
                Log out
              </button>
              <Link href="/doctor/login" className="font-medium text-teal-700 underline underline-offset-2">
                Doctor log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle={`Signed in as ${profile.full_name}`} />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load your dashboard: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (consultations === null || followUps === null) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle={`Signed in as ${profile.full_name}`} />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  const today = todayStr();
  const tomorrow = tomorrowStr();

  const todayCount = consultations.filter((c) => c.created_at.slice(0, 10) === today).length;
  const completedCount = consultations.filter((c) => c.status === "completed").length;
  const waitingCount = consultations.filter((c) => c.status !== "completed").length;
  const flaggedCount = consultations.filter((c) => c.is_flagged).length;

  const overdueFollowUps = followUps.filter((f) => f.follow_up_date < today);
  const todayFollowUps = followUps.filter((f) => f.follow_up_date === today);
  const tomorrowFollowUps = followUps.filter((f) => f.follow_up_date === tomorrow);
  const laterFollowUps = followUps.filter((f) => f.follow_up_date > tomorrow);

  const followUpGroups: { label: string; rows: FollowUpRow[]; emphasize?: boolean }[] = [
    { label: "Overdue", rows: overdueFollowUps, emphasize: true },
    { label: "Today", rows: todayFollowUps, emphasize: true },
    { label: "Tomorrow", rows: tomorrowFollowUps },
    { label: "Later", rows: laterFollowUps },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Signed in as ${profile.full_name}`} />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{todayCount}</div>
            <div className="mt-1 text-xs text-slate-500">Booked today</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{waitingCount}</div>
            <div className="mt-1 text-xs text-slate-500">Waiting / in progress</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{completedCount}</div>
            <div className="mt-1 text-xs text-slate-500">Completed</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <div className="text-2xl font-bold text-red-700">{flaggedCount}</div>
            <div className="mt-1 text-xs text-red-700">Safety alerts</div>
          </div>
        </div>

        <Link
          href="/doctor/queue"
          className="inline-block rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
        >
          Open consultation queue →
        </Link>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Follow-ups
          </h2>
          {followUps.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No follow-ups scheduled yet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {followUpGroups
                .filter((g) => g.rows.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <h3
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        g.emphasize ? "text-red-700" : "text-slate-400"
                      }`}
                    >
                      {g.label} ({g.rows.length})
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {g.rows.map((f, i) => {
                        const c = one(f.consultation);
                        return (
                          <li key={i}>
                            <Link
                              href={c ? `/doctor/consultations/${c.id}` : "#"}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-teal-600"
                            >
                              <div>
                                <span className="font-medium text-slate-900">
                                  {c ? patientName(c.patient) : "Unknown"}
                                </span>
                                <span className="ml-2 text-xs text-slate-500">
                                  {c?.complaint} {f.follow_up_reason ? `· ${f.follow_up_reason}` : ""}
                                </span>
                              </div>
                              <span className="text-xs text-slate-400">
                                {new Date(f.follow_up_date).toLocaleDateString()}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
