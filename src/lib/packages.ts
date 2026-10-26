"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Family packs (migrations 0088-0091). Everything here is fail-soft: until the
// database update has been run, or while the admin's "sales open" switch is
// off, the public-pack call returns nothing and every pack screen stays hidden.
// Nothing else on the site changes.

export interface PackagePublic {
  package_id: string;
  name: string;
  price_pkr: number;
  members_allowed: number;
  consultations_total: number;
  allow_text: boolean;
  allow_audio: boolean;
  allow_video: boolean;
  audio_limit: number | null;
  video_limit: number | null;
  validity_days: number;
  rollover_enabled: boolean;
  reply_window_hours: number;
  spots_left: number | null;
  full: boolean;
}

export interface PackMember {
  id: string;
  name: string;
}

export interface PackConsultation {
  consultation_id: string;
  mode: "text" | "audio" | "video";
  status: string;
  member: string;
  created_at: string;
}

export interface MyPack {
  id: string;
  created_at: string;
  status: string;
  expires_at: string;
  starts_at: string;
  price_pkr: number;
  members_allowed: number;
  consultations_total: number;
  rollover_credits: number;
  allow_text: boolean;
  allow_audio: boolean;
  allow_video: boolean;
  audio_limit: number | null;
  video_limit: number | null;
  reply_window_hours: number;
  credits_left: number;
  audio_used: number;
  video_used: number;
  is_live: boolean;
  doctor: { id: string; name: string; specialty: string | null; photo: string | null; available: boolean };
  members_used: PackMember[];
  consultations: PackConsultation[];
}

// "function ... does not exist" / "Could not find the function" = the database
// update has not been run yet.
export function isMissingFunction(message: string | undefined | null): boolean {
  return !!message && /does not exist|could not find the function|schema cache/i.test(message);
}

export function modesText(p: { allow_text: boolean; allow_audio: boolean; allow_video: boolean; audio_limit?: number | null; video_limit?: number | null }): string {
  const parts: string[] = [];
  if (p.allow_text) parts.push("Text chat with voice notes");
  if (p.allow_audio) parts.push(p.audio_limit ? `audio calls (up to ${p.audio_limit})` : "audio calls");
  if (p.allow_video) parts.push(p.video_limit ? `video calls (up to ${p.video_limit})` : "video calls");
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function pkr(n: number | null | undefined): string {
  return `PKR ${Number(n ?? 0).toLocaleString("en-US")}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

// ---- the pack on a doctor's public page --------------------------------

export function usePackageForDoctor(doctorId: string | undefined): PackagePublic | null {
  const [pack, setPack] = useState<PackagePublic | null>(null);
  useEffect(() => {
    if (!supabase || !doctorId) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("package_public_for_doctor", { p_doctor_id: doctorId })).then(
      ({ data, error }) => {
        if (cancelled) return;
        setPack(!error && data && typeof data === "object" ? (data as PackagePublic) : null);
      },
      () => {
        if (!cancelled) setPack(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [doctorId]);
  return pack;
}

// ---- the signed-in family's own packs ------------------------------------

export function useMyPacks(): { packs: MyPack[] | null; reload: () => void } {
  const [packs, setPacks] = useState<MyPack[] | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!supabase) {
      Promise.resolve().then(() => setPacks([]));
      return;
    }
    let cancelled = false;
    Promise.resolve(supabase.rpc("package_my_purchases")).then(
      ({ data, error }) => {
        if (cancelled) return;
        setPacks(!error && Array.isArray(data) ? (data as MyPack[]) : []);
      },
      () => {
        if (!cancelled) setPacks([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { packs, reload };
}

// ---- referral link: ?pack=<code> ------------------------------------------
// The doctor page already uses ?ref= for its views report, so the pack link
// uses ?pack=. The code is kept in this browser until the person is signed in
// as a patient; then the database records it once (first touch wins).

const REF_KEY = "fm_pack_ref";

export function rememberPackRef(code: string | null | undefined) {
  if (!code) return;
  const clean = code.trim().toLowerCase();
  if (!/^[a-z0-9]{4,20}$/.test(clean)) return;
  try {
    if (!window.localStorage.getItem(REF_KEY)) window.localStorage.setItem(REF_KEY, clean);
  } catch {
    /* storage can be blocked; the link then simply does not count */
  }
}

export async function flushPackRef(): Promise<void> {
  if (!supabase) return;
  let code: string | null = null;
  try {
    code = window.localStorage.getItem(REF_KEY);
    // One try per browser session: a guest or an account that already has a
    // first-touch link would otherwise ask again on every page.
    if (code && window.sessionStorage.getItem(REF_KEY + "_tried") === code) return;
  } catch {
    return;
  }
  if (!code) return;
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return;
  const { data, error } = await supabase.rpc("package_record_ref", { p_code: code });
  if (error) return;
  try {
    if ((data as { recorded?: boolean } | null)?.recorded) window.localStorage.removeItem(REF_KEY);
    else window.sessionStorage.setItem(REF_KEY + "_tried", code);
  } catch {
    /* ignore */
  }
}
