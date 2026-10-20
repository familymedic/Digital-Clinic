"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Free consultation week (migration 0081). Everything is fail-soft: until
// 0081 has been run, or while no campaign is switched on, the status call
// returns phase "none" (or errors) and every free-week screen simply stays
// hidden - nothing else on the site changes.

export type FreeWeekPhase = "none" | "preregister" | "open" | "ended";

export interface FreeWeekStatus {
  phase: FreeWeekPhase;
  name?: string;
  opens_on?: string;
  starts_on?: string;
  ends_on?: string;
  credits_per_account?: number;
  modes?: string[];
  signed_in?: boolean;
  is_guest?: boolean;
  enrolled?: boolean;
  credits_used?: number;
  credits_left?: number;
  phone_on_file?: string | null;
}

const NONE: FreeWeekStatus = { phase: "none" };

// Reads the campaign state. `state` is null while loading.
export function useFreeWeekStatus(refreshKey: string | null = null): {
  status: FreeWeekStatus | null;
  reload: () => void;
} {
  const [status, setStatus] = useState<FreeWeekStatus | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!supabase) {
      Promise.resolve().then(() => setStatus(NONE));
      return;
    }
    let cancelled = false;
    Promise.resolve(supabase.rpc("free_week_status")).then(
      ({ data, error }) => {
        if (cancelled) return;
        if (error || !data || typeof data !== "object") setStatus(NONE);
        else setStatus(data as FreeWeekStatus);
      },
      () => {
        if (!cancelled) setStatus(NONE);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [tick, refreshKey]);
  return { status, reload };
}

// "Mon 26 Oct" from a yyyy-mm-dd date (no time zone shifting).
export function fmtDay(d: string | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Time in Pakistan, e.g. "Tue 27 Oct, 10:05 AM".
export function fmtPkt(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

// "Tue 27 Oct" and "10:05 AM" on their own (Pakistan time). Kept separate so
// no screen has to cut up a combined date-time string.
export function fmtPktDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(iso))
    .replace(",", "");
}

export function fmtPktTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export function pktDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(iso));
}
