"use client";

// Shared types/helpers for the doctor side of the platform (Phase 7). A
// doctor account is a normal Supabase Auth account (same auth.users
// table patients use) that also has a matching row in `doctor_profiles`.
// There is no separate auth system — just a separate front door
// (/doctor/login) and this membership check.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export interface DoctorProfile {
  id: string;
  full_name: string;
  created_at: string;
}

// Doctor onboarding, step 1 (2026-09-14): a doctor_profiles row can now
// exist for someone who has applied but isn't approved yet (or was
// rejected, or was deactivated) — self-registration (src/app/api/
// doctors/register) always creates one as 'pending_review'/inactive. A
// raw row is no longer, by itself, enough to mean "let this account into
// /doctor" the way it used to when every doctor was hand-added by admin
// and active by default (0015/0026). `applicationStatus` carries the
// real reason for a friendlier message on /doctor/login and the main
// dashboard; every OTHER /doctor/* page keeps working exactly as before
// because they all gate on `!profile` already — this file is the one
// place that decides what counts as "profile", so the fix applies
// everywhere at once rather than needing five separate edits.
export type DoctorApplicationStatus = "pending_review" | "rejected" | "inactive" | null;

interface RawDoctorRow {
  id: string;
  full_name: string;
  created_at: string;
  verification_status: "pending_review" | "approved" | "rejected";
  is_active: boolean;
}

function isLive(row: RawDoctorRow): boolean {
  return row.verification_status === "approved" && row.is_active;
}

function statusFor(row: RawDoctorRow): DoctorApplicationStatus {
  if (isLive(row)) return null;
  if (row.verification_status === "pending_review") return "pending_review";
  if (row.verification_status === "rejected") return "rejected";
  return "inactive"; // approved but is_active = false (admin-deactivated)
}

// undefined = not checked yet, null = checked and this isn't a doctor
// account, DoctorProfile = confirmed, approved, active doctor. Every
// /doctor page needs this same check (a patient's own session can
// legitimately reach these URLs), so it's centralized here rather than
// repeated per page.
export function useDoctorProfile() {
  const { session, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<DoctorProfile | null | undefined>(undefined);
  const [applicationStatus, setApplicationStatus] = useState<DoctorApplicationStatus>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("doctor_profiles")
      .select("id, full_name, created_at, verification_status, is_active")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        const row = data as RawDoctorRow | null;
        if (!row) {
          setProfile(null);
          setApplicationStatus(null);
          return;
        }
        if (isLive(row)) {
          setProfile({ id: row.id, full_name: row.full_name, created_at: row.created_at });
        } else {
          setProfile(null);
          setApplicationStatus(statusFor(row));
        }
      });
  }, [session]);

  return {
    session,
    authLoading,
    profile,
    applicationStatus,
    profileChecking: !!session && profile === undefined && !error,
    error,
  };
}

// Same as useDoctorProfile(), plus signOut — every /doctor page's
// "this isn't a doctor account" state offers a log-out button, so this
// is the one hook those pages actually import.
export function useDoctorProfileWithSignOut() {
  const { signOut } = useAuth();
  return { ...useDoctorProfile(), signOut };
}

// Doctor onboarding, step 4 (2026-09-21): whether an approved doctor's
// workspace is actually gated behind the PKR 5,000/month platform
// subscription. Deliberately a no-op unless NEXT_PUBLIC_
// ENFORCE_DOCTOR_SUBSCRIPTION="true" is explicitly set — see 0030's
// migration comment: enforcement was intentionally held back until a
// real Safepay Subscriptions renewal charge had been confirmed firing
// on its own (the sandbox test this project ran on 2026-09-21).
// Flipping the env var on later (and redeploying) is the only step
// needed to turn this on — nothing else about the app changes until
// then, and this file makes no change at all to the one-time
// consultation-payment webhook or its logic.
//
// IMPORTANT before ever turning this on: use /admin/subscriptions to
// mark any doctor who should already count as paid up (the physician's
// own account, anyone billed outside Safepay) as "active" first —
// every doctor_profiles row defaults to subscription_status='unpaid'
// (0030), so flipping this on with no doctors marked active would lock
// every doctor out at once, including the clinic's own account.
const ENFORCE_DOCTOR_SUBSCRIPTION = process.env.NEXT_PUBLIC_ENFORCE_DOCTOR_SUBSCRIPTION === "true";

export type DoctorSubscriptionStatus = "unpaid" | "active" | "past_due" | "canceled";

interface SubscriptionRow {
  subscription_status: DoctorSubscriptionStatus;
  email: string | null;
  subscription_current_period_end: string | null;
}

// Fails open by design, the same posture as the rest of this file: while
// enforcement is off, or the doctor id isn't known yet, or the query
// hasn't returned yet, or it errors, `locked` is always false. It can
// only ever become true once enforcement is explicitly on AND a
// definite, non-active status has actually been read back — a slow
// network or a transient Supabase error should never be the reason a
// real, paid-up doctor gets shut out of their own workspace.
export function useDoctorSubscriptionGate(doctorId: string | undefined) {
  const [status, setStatus] = useState<DoctorSubscriptionStatus | null>(null);
  const [checkoutEmail, setCheckoutEmail] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!ENFORCE_DOCTOR_SUBSCRIPTION || !doctorId || !supabase) {
      return;
    }
    let cancelled = false;
    supabase
      .from("doctor_profiles")
      .select("subscription_status, email, subscription_current_period_end")
      .eq("id", doctorId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const row = data as SubscriptionRow;
        setStatus(row.subscription_status);
        setCheckoutEmail(row.email);
        setPeriodEnd(row.subscription_current_period_end);
        setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  // Step 6 (2026-09-21), physician's explicit choice: once a doctor's
  // 30-day period actually runs out, access should lock itself
  // automatically — computed live from the stored date, same as the
  // matching database-level check (0044) — rather than only relying on
  // `subscription_status` staying accurate, which nothing here ever
  // flips back on its own (no scheduled job, no email, by design). The
  // UI and the database must agree on exactly this same rule, or a
  // doctor could see one thing in the app while the database quietly
  // enforces another.
  const periodEndDate = periodEnd ? new Date(periodEnd) : null;
  const expired = !!periodEndDate && periodEndDate.getTime() <= Date.now();
  const daysRemaining = periodEndDate
    ? Math.ceil((periodEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  // "Renew soon" is a non-blocking heads-up shown on an otherwise-normal
  // dashboard in the last 5 days of a still-active period — deliberately
  // separate from `locked`, which only ever becomes true once the
  // period has actually ended.
  const renewSoon =
    ENFORCE_DOCTOR_SUBSCRIPTION &&
    checked &&
    status === "active" &&
    !expired &&
    daysRemaining !== null &&
    daysRemaining <= 5;

  return {
    enforced: ENFORCE_DOCTOR_SUBSCRIPTION,
    checked,
    status,
    checkoutEmail,
    periodEnd,
    daysRemaining,
    renewSoon,
    locked: ENFORCE_DOCTOR_SUBSCRIPTION && checked && ((status !== null && status !== "active") || expired),
  };
}
