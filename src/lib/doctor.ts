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

// undefined = not checked yet, null = checked and this isn't a doctor
// account, DoctorProfile = confirmed doctor. Every /doctor page needs
// this same check (a patient's own session can legitimately reach these
// URLs), so it's centralized here rather than repeated per page.
export function useDoctorProfile() {
  const { session, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<DoctorProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("doctor_profiles")
      .select("id, full_name, created_at")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setProfile(data as DoctorProfile | null);
        }
      });
  }, [session]);

  return {
    session,
    authLoading,
    profile,
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
