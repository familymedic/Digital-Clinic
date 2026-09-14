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
