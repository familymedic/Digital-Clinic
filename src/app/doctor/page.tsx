"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 7 — the Dashboard (Section 13/14): a summary/overview landing
// page, separate from the full list (/doctor/queue). "Today's
// consultations, completed/waiting/follow-ups, safety alerts, basic
// activity info" per Section 14 — revenue is left out for now since
// there's no payment collection at all yet (Phase 10). Follow-ups are
// grouped Today/Tomorrow/Later/Overdue exactly as Section 16 called for.
//
// Visual redesign (2026-09-14): sidebar layout + elevated stat tiles,
// same underlying data/logic as before — nothing here is fabricated,
// every number below comes from the same two queries this page always
// ran.

interface ConsultationRow {
  id: string;
  complaint: string;
  status: string;
  is_flagged: boolean;
  created_at: string;
  patient: { full_name: string } | { full_name: string }[] | null;
}

interface SubscriptionRow {
  email: string | null;
  subscription_status: "unpaid" | "active" | "past_due" | "canceled";
  subscription_current_period_end: string | null;
}

// The Safepay-hosted "subscribe" page for the platform's own PKR
// 5,000/month plan. A plain public checkout link, not a secret — set
// once the physician has created the real plan in Safepay's dashboard
// (docs/safepay-subscriptions-sandbox-test-steps-2026-09-14.md). Not
// dynamically generated per-doctor: doing that would need Safepay's
// undocumented "Time Based Token" mechanism, whose exact REST call
// isn't confirmed anywhere in their public docs or SDK source — so
// matching happens by email instead (see the webhook route), and every
// doctor uses the same link.
const SUBSCRIPTION_CHECKOUT_URL = process.env.NEXT_PUBLIC_SAFEPAY_DOCTOR_SUBSCRIPTION_CHECKOUT_URL;

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function SidebarLink({
  icon,
  label,
  href,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
        active ? "bg-teal-50 text-teal-700" : "text-ink-500 hover:bg-[var(--background)]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function Shell({ children, doctorName, onSignOut }: { children: React.ReactNode; doctorName?: string; onSignOut?: () => void }) {
  return (
    <div className="mx-auto flex max-w-6xl">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-ink-border bg-white px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-brand-950 text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="text-sm font-extrabold tracking-tight text-ink-900">Doctor Workspace</span>
        </div>

        <nav className="flex flex-col gap-1">
          <SidebarLink
            active
            href="/doctor"
            label="Dashboard"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
              </svg>
            }
          />
          <SidebarLink
            href="/doctor/queue"
            label="Consultation Queue"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 4v5" />
              </svg>
            }
          />
          <SidebarLink
            href="/doctor/availability"
            label="Availability"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><circle cx="12" cy="15" r="2.2" />
              </svg>
            }
          />
        </nav>

        {doctorName && (
          <div className="mt-auto flex items-center gap-2.5 rounded-2xl bg-[var(--background)] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-xs font-bold text-white">
              {initials(doctorName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-ink-900">{doctorName}</div>
              {onSignOut && (
                <button onClick={onSignOut} className="text-[11.5px] font-semibold text-ink-500 hover:text-teal-700">
                  Log out
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">{children}</div>
    </div>
  );
}

export default function DoctorDashboard() {
  const { session, authLoading, profile, applicationStatus, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();
  const [consultations, setConsultations] = useState<ConsultationRow[] | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRow[] | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase || !profile) return;
    supabase
      .from("doctor_profiles")
      .select("email, subscription_status, subscription_current_period_end")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setSubscription(data as SubscriptionRow | null));

    Promise.all([
      supabase
        .from("consultations")
        .select("id, complaint, status, is_flagged, created_at, patient:family_members(full_name)")
        // Phase 10: unpaid bookings aren't the doctor's work yet — see
        // the same note on /doctor/queue.
        .neq("status", "pending_payment"),
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
      <Shell>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
      </Shell>
    );
  }

  if (authLoading || profileChecking) {
    return <Shell><p className="text-sm text-ink-500">Loading…</p></Shell>;
  }

  if (!session) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
          <p>Please log in with your doctor account first.</p>
          <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
            Doctor log in
          </Link>
        </div>
      </Shell>
    );
  }

  if (profileError) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </Shell>
    );
  }

  if (!profile) {
    // Doctor onboarding, step 1: an existing session that predates
    // approval (or was deactivated/rejected after logging in earlier)
    // lands here too, not just "not a doctor account" — same defense
    // this app already uses at login, applied again in case a session
    // persists across a status change.
    const message =
      applicationStatus === "pending_review"
        ? "Your application is still under review. We'll be in touch once your PMDC certificate has been checked."
        : applicationStatus === "rejected"
          ? "Your application wasn't approved. Please contact us if you have questions."
          : applicationStatus === "inactive"
            ? "Your account has been deactivated. Please contact the platform administrator."
            : "This account isn't set up as a doctor account.";
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{message}</p>
          <div className="mt-4 flex gap-4">
            <button onClick={() => signOut()} className="font-semibold text-teal-700 underline underline-offset-2">
              Log out
            </button>
            <Link href="/doctor/login" className="font-semibold text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell doctorName={profile.full_name} onSignOut={signOut}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load your dashboard: {loadError}
        </div>
      </Shell>
    );
  }

  if (consultations === null || followUps === null) {
    return (
      <Shell doctorName={profile.full_name} onSignOut={signOut}>
        <p className="text-sm text-ink-500">Loading…</p>
      </Shell>
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

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Shell doctorName={profile.full_name} onSignOut={signOut}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
            Welcome back, Dr. {profile.full_name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{todayLabel}</p>
        </div>
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-sm font-bold text-white sm:flex">
          {initials(profile.full_name)}
        </span>
      </div>

      {subscription && subscription.subscription_status !== "active" && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="text-sm font-bold text-amber-900">
            {subscription.subscription_status === "past_due"
              ? "Your platform subscription payment didn't go through"
              : subscription.subscription_status === "canceled"
                ? "Your platform subscription was canceled"
                : "Platform subscription (PKR 5,000/month) not yet set up"}
          </div>
          <p className="mt-1 text-xs text-amber-800">
            {SUBSCRIPTION_CHECKOUT_URL
              ? `Subscribe using this same email (${subscription.email ?? "your account email"}) so it's matched to your account automatically.`
              : "Subscription payment isn't set up yet — the clinic will follow up separately."}
          </p>
          {SUBSCRIPTION_CHECKOUT_URL && (
            <a
              href={SUBSCRIPTION_CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-full bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800"
            >
              Pay subscription →
            </a>
          )}
        </div>
      )}
      {subscription && subscription.subscription_status === "active" && (
        <div className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-xs font-semibold text-teal-800">
          Platform subscription active
          {subscription.subscription_current_period_end &&
            ` — renews around ${new Date(subscription.subscription_current_period_end).toLocaleDateString()}`}
          .
        </div>
      )}

      {/* Stat tiles */}
      <div className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </span>
          <div>
            <div className="text-2xl font-extrabold text-ink-900">{todayCount}</div>
            <div className="text-xs text-ink-500">Booked today</div>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
            </svg>
          </span>
          <div>
            <div className="text-2xl font-extrabold text-ink-900">{waitingCount}</div>
            <div className="text-xs text-ink-500">Waiting / in progress</div>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <div>
            <div className="text-2xl font-extrabold text-ink-900">{completedCount}</div>
            <div className="text-xs text-ink-500">Completed</div>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <div>
            <div className="text-2xl font-extrabold text-red-700">{flaggedCount}</div>
            <div className="text-xs text-red-700">Safety alerts</div>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href="/doctor/queue"
          className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800"
        >
          Open consultation queue →
        </Link>
        <Link
          href="/doctor/availability"
          className="rounded-full border border-ink-border bg-white px-5 py-2.5 text-sm font-semibold text-ink-900 shadow-sm transition hover:border-teal-700 hover:text-teal-700"
        >
          Manage availability
        </Link>
      </div>

      <section className="mt-9">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
          Follow-ups
        </h2>
        {followUps.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No follow-ups scheduled yet.</p>
        ) : (
          <div className="mt-4 space-y-5">
            {followUpGroups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.label}>
                  <h3
                    className={`text-xs font-bold uppercase tracking-wide ${
                      g.emphasize ? "text-red-700" : "text-ink-400"
                    }`}
                  >
                    {g.label} ({g.rows.length})
                  </h3>
                  <div className="mt-2 space-y-2">
                    {g.rows.map((f, i) => {
                      const c = one(f.consultation);
                      return (
                        <Link
                          key={i}
                          href={c ? `/doctor/consultations/${c.id}` : "#"}
                          className="flex items-center gap-3.5 rounded-2xl border border-ink-border bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-200"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-indigo-700 text-xs font-bold text-white">
                            {initials(c ? patientName(c.patient) : "?")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-ink-900">
                              {c ? patientName(c.patient) : "Unknown"}
                            </div>
                            <div className="truncate text-xs text-ink-500">
                              {c?.complaint} {f.follow_up_reason ? `· ${f.follow_up_reason}` : ""}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-medium text-ink-400">
                            {new Date(f.follow_up_date).toLocaleDateString()}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
