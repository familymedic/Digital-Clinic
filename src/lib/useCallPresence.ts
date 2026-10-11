"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isFresh } from "@/lib/callWindow";

// "Who is waiting" signal for a consultation (2026-10-11).
//
// While `active`, this checks in for the current person every 30 seconds
// (touch_call_presence, migration 0069) and reads the other person's last
// check-in every 15 seconds. Completely fail-soft: if the migration has
// not been applied yet, or the network drops, nothing breaks — the
// "waiting" message simply never appears and the call itself is untouched.

interface PresenceRow {
  patient_last_seen_at: string | null;
  doctor_last_seen_at: string | null;
}

export function useCallPresence(
  consultationId: string,
  role: "patient" | "doctor",
  active: boolean,
  nowMs: number
): { otherWaiting: boolean; otherLastSeenAt: string | null } {
  const [row, setRow] = useState<PresenceRow | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client || !active || !consultationId) return;
    let cancelled = false;
    let failures = 0;

    async function beat() {
      if (failures >= 3 || !client) return;
      try {
        const { error } = await client.rpc("touch_call_presence", { p_consultation_id: consultationId });
        if (error) failures += 1;
      } catch {
        failures += 1;
      }
    }

    async function read() {
      if (failures >= 3 || !client) return;
      try {
        const { data, error } = await client
          .from("consultations")
          .select("patient_last_seen_at, doctor_last_seen_at")
          .eq("id", consultationId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          failures += 1;
          return;
        }
        setRow((data as PresenceRow | null) ?? null);
      } catch {
        failures += 1;
      }
    }

    beat().then(read);
    const beatTimer = setInterval(beat, 30_000);
    const readTimer = setInterval(read, 15_000);
    return () => {
      cancelled = true;
      clearInterval(beatTimer);
      clearInterval(readTimer);
    };
  }, [consultationId, role, active]);

  const otherLastSeenAt = row ? (role === "patient" ? row.doctor_last_seen_at : row.patient_last_seen_at) : null;
  return { otherWaiting: active && isFresh(otherLastSeenAt, nowMs), otherLastSeenAt };
}
