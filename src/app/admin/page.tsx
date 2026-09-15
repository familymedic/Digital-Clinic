"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { isDatabaseConfigured } from "@/lib/supabaseClient";
import { useAdminProfileWithSignOut } from "@/lib/admin";

// Admin system: the hub page. Deliberately just a set of links for now —
// per the audit's own "build incrementally, don't over-build a control
// center up front" call. Each linked screen is its own small, testable
// increment.

export default function AdminHome() {
  const { session, authLoading, profile, profileChecking, error, signOut } = useAdminProfileWithSignOut();

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
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
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Admin" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in with your admin account first.</p>
            <Link href="/admin/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
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
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
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
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as an admin account.</p>
            <div className="mt-4 flex gap-4">
              <button onClick={() => signOut()} className="font-medium text-teal-700 underline underline-offset-2">
                Log out
              </button>
              <Link href="/admin/login" className="font-medium text-teal-700 underline underline-offset-2">
                Admin log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sections = [
    {
      href: "/admin/safety-events",
      title: "Safety flags",
      description: "Review and resolve flagged consultations across every doctor.",
    },
    {
      href: "/admin/doctors",
      title: "Doctors",
      description: "Add a new doctor, or activate/deactivate an existing one.",
    },
    {
      href: "/admin/payouts",
      title: "Doctor payouts",
      description: "Generate and track each doctor's monthly payout, based on their own consultation fee.",
    },
    {
      href: "/admin/subscriptions",
      title: "Doctor subscriptions",
      description: "See who's paid the PKR 5,000/month platform fee, and correct it manually if needed.",
    },
    {
      href: "/admin/refunds",
      title: "Payments & refunds",
      description: "See every payment and record a refund once it's processed in Safepay.",
    },
    {
      href: "/admin/feedback",
      title: "Reviews & complaints",
      description: "See what patients have said — admin-only for now.",
    },
    {
      href: "/admin/ads",
      title: "Sponsored ads",
      description: "Upload and run a paid, clearly-labeled sponsor placement on the home page.",
    },
    {
      href: "/admin/metrics",
      title: "Business metrics",
      description: "Site traffic, bookings, and revenue — a snapshot of how the business is doing.",
    },
  ];

  return (
    <div>
      <PageHeader title="Admin" subtitle={`Signed in as ${profile.full_name}`} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-600"
          >
            <div className="text-sm font-semibold text-slate-900">{s.title}</div>
            <div className="mt-1 text-sm text-slate-500">{s.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
