"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { fmtDay } from "@/lib/freeWeek";

// Small card on the doctor dashboard that only appears while a free week is
// set up (migration 0081). Invisible, and harmless, otherwise.
export default function DoctorFreeWeekCard() {
  const [s, setS] = useState<{ phase: string; name?: string; starts_on?: string; ends_on?: string; opted_in?: boolean } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("free_week_my_state")).then(
      ({ data, error }) => {
        if (!cancelled && !error && data && typeof data === "object") setS(data as typeof s);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (!s || s.phase === "none") return null;
  return (
    <Link
      href="/doctor/free-week"
      className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-[#fff8ea] p-4 transition hover:bg-[#fff3d9]"
    >
      <span>
        <span className="block text-sm font-extrabold text-amber-900">{s.name ?? "Free Family Consultation Week"}</span>
        <span className="block text-xs text-amber-800">
          {fmtDay(s.starts_on)} to {fmtDay(s.ends_on)} &middot; {s.opted_in ? "You are taking part" : "Would you like to take part?"}
        </span>
      </span>
      <span className="shrink-0 text-sm font-extrabold text-amber-900" aria-hidden="true">
        &rsaquo;
      </span>
    </Link>
  );
}
