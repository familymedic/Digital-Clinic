"use client";

import { useEffect, useState } from "react";

// Shared timing rules for scheduled audio/video calls (2026-10-11).
// Everything here is display-only: it decides what each person's page
// shows (a countdown, or the Join button). It never blocks the server.

// How long before the booked start time each side can open the call.
export const PATIENT_JOIN_OPENS_MIN = 10;
export const DOCTOR_JOIN_OPENS_MIN = 15;

// A person counts as "in the waiting room" while their call page has
// checked in within this long (the page checks in every ~30 seconds).
export const PRESENCE_FRESH_MS = 90_000;

/** Re-renders the caller every `ms` and returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "4:30 PM" in Pakistan time. */
export function formatPktTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function pktDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}

/** "Today 4:30 PM", "Tomorrow 10:00 AM" or "12 Oct, 4:30 PM" (Pakistan time). */
export function formatPktWhen(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso);
  const time = formatPktTime(iso);
  const now = new Date(nowMs);
  if (pktDay(d) === pktDay(now)) return `Today ${time}`;
  if (pktDay(d) === pktDay(new Date(nowMs + 24 * 3600 * 1000))) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" }).format(d);
  return `${day}, ${time}`;
}

/** "1h 05m", "9m 30s", "45s" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export interface JoinWindow {
  /** The booked start time, or null when there is no slot on file. */
  startMs: number | null;
  /** When joining opens (ms), or null with no slot. */
  opensMs: number | null;
  /** True when the person may join now (no slot on file counts as open). */
  open: boolean;
  /** Milliseconds until joining opens (0 once open). */
  msUntilOpen: number;
  /** Milliseconds until the booked start (negative once started). */
  msUntilStart: number | null;
}

export function joinWindow(startIso: string | null | undefined, opensMinutesBefore: number, nowMs: number): JoinWindow {
  if (!startIso) {
    return { startMs: null, opensMs: null, open: true, msUntilOpen: 0, msUntilStart: null };
  }
  const startMs = new Date(startIso).getTime();
  const opensMs = startMs - opensMinutesBefore * 60_000;
  return {
    startMs,
    opensMs,
    open: nowMs >= opensMs,
    msUntilOpen: Math.max(0, opensMs - nowMs),
    msUntilStart: startMs - nowMs,
  };
}

export function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  return nowMs - new Date(iso).getTime() <= PRESENCE_FRESH_MS;
}
