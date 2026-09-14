"use client";

// Shared types/helpers for the admin side of the platform. An admin
// account is a normal Supabase Auth account that also has a matching row
// in `admin_profiles` (0025) — same pattern as doctor_profiles: no
// separate auth system, just a separate front door (/admin/login) and
// this membership check. An account can be a doctor AND an admin at the
// same time (today, the physician is both), or admin-only later (e.g. a
// non-doctor staff member who only publishes content).

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export interface AdminProfile {
  id: string;
  full_name: string;
  created_at: string;
}

// undefined = not checked yet, null = checked and this isn't an admin
// account, AdminProfile = confirmed admin.
export function useAdminProfile() {
  const { session, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<AdminProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("admin_profiles")
      .select("id, full_name, created_at")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setProfile(data as AdminProfile | null);
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

export function useAdminProfileWithSignOut() {
  const { signOut } = useAuth();
  return { ...useAdminProfile(), signOut };
}
