"use client";

import { ReactNode } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { isDatabaseConfigured } from "@/lib/supabaseClient";
import { useAdminProfileWithSignOut, type AdminProfile } from "@/lib/admin";

// Shared guard for every /admin/* page below the hub — same branches as
// AdminHome, factored out so the five admin screens (safety-events,
// doctors, payouts, refunds, feedback) don't each repeat this block.
// New for the admin system since it's five very similar pages at once;
// existing doctor/patient pages predate this and weren't touched.

export default function AdminGuard({
  title,
  children,
}: {
  title: string;
  children: (profile: AdminProfile) => ReactNode;
}) {
  const { session, authLoading, profile, profileChecking, error, signOut } = useAdminProfileWithSignOut();

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title={title} />
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
        <PageHeader title={title} />
        <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title={title} />
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
        <PageHeader title={title} />
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
        <PageHeader title={title} />
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

  return <>{children(profile)}</>;
}
