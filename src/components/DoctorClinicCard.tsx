"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// Small card on the doctor dashboard (Locator, migration 0097): invites a paid doctor to add
// their clinic to the Family Medic Locator. Invisible until the database update has been run,
// and for anyone who is not an eligible doctor.
export default function DoctorClinicCard() {
  const [s, setS] = useState<{ doctor?: boolean; eligible?: boolean; active_places?: number; free_until?: string | null } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("locator_doctor_status")).then(
      ({ data, error }) => {
        if (!cancelled && !error && data && typeof data === "object") setS(data as typeof s);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (!s || !s.doctor || !s.eligible) return null;
  const n = s.active_places ?? 0;
  return (
    <Link
      href="/doctor/clinic"
      data-testid="doctor-clinic-card"
      className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-teal-200 bg-[#effaf7] p-4 transition hover:bg-[#e3f6f1]"
    >
      <span>
        <span className="block text-sm font-extrabold text-teal-900">
          {n === 0 ? "Put your clinic on the Family Medic Locator" : `Your clinic on the Locator (${n} listed)`}
        </span>
        <span className="block text-xs text-teal-800">
          {n === 0 ? "Your first clinic is free for the first year. Add the pin and opening hours so families can find you." : "Edit your details and opening hours, renew, or add another clinic."}
        </span>
      </span>
      <span className="shrink-0 text-sm font-extrabold text-teal-900" aria-hidden="true">
        &rsaquo;
      </span>
    </Link>
  );
}
