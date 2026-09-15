"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { isDatabaseConfigured } from "@/lib/supabaseClient";
import { supabase } from "@/lib/supabaseClient";
import { useAdminProfileWithSignOut } from "@/lib/admin";

// Admin system: the hub page. Deliberately just a set of links for now —
// per the audit's own "build incrementally, don't over-build a control
// center up front" call. Each linked screen is its own small, testable
// increment.
//
// Visual redesign (2026-09-15): brought the hub up to the same "decent
// dashboard" look already used on the public site and the doctor
// workspace — the ink-*/brand-950 token system, elevated stat tiles, and
// a richer card grid with a live status badge per section — matching the
// "Enhanced Card Hub" direction picked from the three options sketched
// for review. Kept the existing top-bar page structure rather than
// adding a sidebar, since that's the lower-risk of the two directions
// and every stat/badge below is a real read from the same tables each
// linked screen already queries — nothing here is fabricated.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

interface HubStats {
  openSafetyFlags: number;
  activeDoctors: number;
  pendingPayoutsAmount: number;
  subscriptionIssues: number;
  pendingPayments: number;
  openFeedback: number;
  liveAds: number;
  visitsToday: number;
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AdminHome() {
  const { session, authLoading, profile, profileChecking, error, signOut } = useAdminProfileWithSignOut();
  const [stats, setStats] = useState<HubStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase || !profile) return;

    Promise.all([
      supabase.from("consultation_safety_events").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("doctor_profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("doctor_payouts").select("amount").eq("status", "pending"),
      supabase
        .from("doctor_profiles")
        .select("id", { count: "exact", head: true })
        .in("subscription_status", ["past_due", "unpaid"]),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("patient_feedback").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("active_sponsored_ads").select("id", { count: "exact", head: true }),
      supabase.from("site_page_views").select("id", { count: "exact", head: true }).gte("created_at", todayStartIso()),
    ]).then(
      ([
        safetyRes,
        doctorsRes,
        payoutsRes,
        subsRes,
        paymentsRes,
        feedbackRes,
        adsRes,
        visitsRes,
      ]) => {
        const firstError =
          safetyRes.error ||
          doctorsRes.error ||
          payoutsRes.error ||
          subsRes.error ||
          paymentsRes.error ||
          feedbackRes.error ||
          adsRes.error ||
          visitsRes.error;
        if (firstError) {
          setStatsError(firstError.message);
          return;
        }
        const pendingPayoutsAmount = (payoutsRes.data ?? []).reduce(
          (sum, row: { amount: number }) => sum + Number(row.amount ?? 0),
          0
        );
        setStats({
          openSafetyFlags: safetyRes.count ?? 0,
          activeDoctors: doctorsRes.count ?? 0,
          pendingPayoutsAmount,
          subscriptionIssues: subsRes.count ?? 0,
          pendingPayments: paymentsRes.count ?? 0,
          openFeedback: feedbackRes.count ?? 0,
          liveAds: adsRes.count ?? 0,
          visitsToday: visitsRes.count ?? 0,
        });
      }
    );
  }, [session, profile]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-ink-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
            <p>Please log in with your admin account first.</p>
            <Link href="/admin/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
              Admin log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t verify your admin account: {error}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as an admin account.</p>
            <div className="mt-4 flex gap-4">
              <button onClick={() => signOut()} className="font-semibold text-teal-700 underline underline-offset-2">
                Log out
              </button>
              <Link href="/admin/login" className="font-semibold text-teal-700 underline underline-offset-2">
                Admin log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sections: {
    href: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    badge?: { label: string; tone: "red" | "amber" | "teal" };
  }[] = [
    {
      href: "/admin/safety-events",
      title: "Safety flags",
      description: "Review and resolve flagged consultations across every doctor.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      ),
      badge: stats
        ? stats.openSafetyFlags > 0
          ? { label: `${stats.openSafetyFlags} open`, tone: "red" }
          : { label: "All clear", tone: "teal" }
        : undefined,
    },
    {
      href: "/admin/doctors",
      title: "Doctors",
      description: "Add a new doctor, or activate/deactivate an existing one.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
        </svg>
      ),
      badge: stats ? { label: `${stats.activeDoctors} active`, tone: "teal" } : undefined,
    },
    {
      href: "/admin/payouts",
      title: "Doctor payouts",
      description: "Generate and track each doctor's monthly payout, based on their own consultation fee.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M8 15h3" />
        </svg>
      ),
      badge: stats
        ? stats.pendingPayoutsAmount > 0
          ? { label: `PKR ${stats.pendingPayoutsAmount.toLocaleString()} due`, tone: "amber" }
          : { label: "All paid", tone: "teal" }
        : undefined,
    },
    {
      href: "/admin/subscriptions",
      title: "Doctor subscriptions",
      description: "See who's paid the PKR 5,000/month platform fee, and correct it manually if needed.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><circle cx="12" cy="15" r="2.2" />
        </svg>
      ),
      badge: stats
        ? stats.subscriptionIssues > 0
          ? { label: `${stats.subscriptionIssues} past due`, tone: "amber" }
          : { label: "All current", tone: "teal" }
        : undefined,
    },
    {
      href: "/admin/refunds",
      title: "Payments & refunds",
      description: "See every payment and record a refund once it's processed in Safepay.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
        </svg>
      ),
      badge: stats
        ? stats.pendingPayments > 0
          ? { label: `${stats.pendingPayments} pending`, tone: "amber" }
          : { label: "None pending", tone: "teal" }
        : undefined,
    },
    {
      href: "/admin/feedback",
      title: "Reviews & complaints",
      description: "See what patients have said — admin-only for now.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3L3 9.5l6.4-.6z" />
        </svg>
      ),
      badge: stats
        ? stats.openFeedback > 0
          ? { label: `${stats.openFeedback} new`, tone: "red" }
          : { label: "None open", tone: "teal" }
        : undefined,
    },
    {
      href: "/admin/ads",
      title: "Sponsored ads",
      description: "Upload and run a paid, clearly-labeled sponsor placement on the home page.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11v2a2 2 0 0 0 2 2h1l2 5 2-1-1.5-4H14l6 3V6l-6 3H6a2 2 0 0 0-2 2z" />
        </svg>
      ),
      badge: stats
        ? stats.liveAds > 0
          ? { label: `${stats.liveAds} live`, tone: "teal" }
          : { label: "None live", tone: "amber" }
        : undefined,
    },
    {
      href: "/admin/metrics",
      title: "Business metrics",
      description: "Site traffic, bookings, and revenue — a snapshot of how the business is doing.",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V10M12 20V4M20 20v-7" />
        </svg>
      ),
    },
  ];

  const badgeClass: Record<"red" | "amber" | "teal", string> = {
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    teal: "bg-teal-50 text-teal-700",
  };

  return (
    <div>
      <div className="border-b border-ink-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-10 sm:px-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">Admin</h1>
            <p className="mt-1 text-sm text-ink-500">Signed in as {profile.full_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-sm font-bold text-white sm:flex">
              {initials(profile.full_name)}
            </span>
            <button
              onClick={() => signOut()}
              className="rounded-full border border-ink-border bg-white px-4 py-2 text-xs font-semibold text-ink-500 transition hover:border-teal-700 hover:text-teal-700"
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {statsError && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            Some live numbers below couldn&rsquo;t load: {statsError}
          </div>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <div
            className={`flex items-center gap-4 rounded-2xl border p-5 shadow-sm ${
              stats && stats.openSafetyFlags > 0 ? "border-red-100 bg-red-50" : "border-ink-border bg-white"
            }`}
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                stats && stats.openSafetyFlags > 0 ? "bg-red-100 text-red-700" : "bg-teal-50 text-teal-700"
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <div>
              <div className={`text-2xl font-extrabold ${stats && stats.openSafetyFlags > 0 ? "text-red-700" : "text-ink-900"}`}>
                {stats ? stats.openSafetyFlags : "—"}
              </div>
              <div className={`text-xs ${stats && stats.openSafetyFlags > 0 ? "text-red-700" : "text-ink-500"}`}>Open safety flags</div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
              </svg>
            </span>
            <div>
              <div className="text-2xl font-extrabold text-ink-900">{stats ? stats.activeDoctors : "—"}</div>
              <div className="text-xs text-ink-500">Active doctors</div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" />
              </svg>
            </span>
            <div>
              <div className="text-2xl font-extrabold text-ink-900">
                {stats ? `PKR ${stats.pendingPayoutsAmount.toLocaleString()}` : "—"}
              </div>
              <div className="text-xs text-ink-500">Pending payouts</div>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20V10M12 20V4M20 20v-7" />
              </svg>
            </span>
            <div>
              <div className="text-2xl font-extrabold text-ink-900">{stats ? stats.visitsToday : "—"}</div>
              <div className="text-xs text-ink-500">Site visits today</div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-xs text-ink-400">
          Every number above is a live read from the same tables each linked screen manages — nothing here is a
          fabricated or estimated figure.
        </p>

        {/* Section cards */}
        <div className="mt-4 text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Manage</div>
        <div className="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm transition hover:border-teal-200"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-teal-50 text-teal-700">
                  {s.icon}
                </span>
                {s.badge && (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClass[s.badge.tone]}`}>
                    {s.badge.label}
                  </span>
                )}
              </div>
              <div className="mt-3.5 text-sm font-bold text-ink-900">{s.title}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{s.description}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
