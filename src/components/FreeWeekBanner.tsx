"use client";

import Link from "next/link";
import { fmtDay, useFreeWeekStatus } from "@/lib/freeWeek";

// Slim announcement bar for the free consultation week (migration 0081).
// Shows nothing at all unless a campaign is switched on and running, so it is
// safe to leave mounted permanently.
export default function FreeWeekBanner() {
  const { status } = useFreeWeekStatus();
  if (!status || (status.phase !== "preregister" && status.phase !== "open")) return null;
  const open = status.phase === "open";
  return (
    <Link
      href="/free-week"
      className="block bg-[#ffb454] px-4 py-2.5 text-center text-sm font-extrabold text-[#3a2500] transition hover:bg-[#ffa62e]"
    >
      {open
        ? `FREE this week: up to ${status.credits_per_account ?? 3} free consultations per family — claim yours ›`
        : `FREE family consultations start ${fmtDay(status.starts_on)} — register your family now ›`}
    </Link>
  );
}
