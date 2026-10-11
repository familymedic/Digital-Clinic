"use client";

import { formatCountdown, formatPktWhen } from "@/lib/callWindow";

// Shown instead of the call while it is too early to join (2026-10-11).
// Gives a clear start time, exactly when joining opens, and a live
// countdown — so nobody wonders "is it broken?" or joins an empty room.

export default function CallWaitCard({
  startIso,
  msUntilOpen,
  opensMinutesBefore,
  nowMs,
  who,
}: {
  startIso: string;
  msUntilOpen: number;
  opensMinutesBefore: number;
  nowMs: number;
  who: "doctor" | "patient";
}) {
  return (
    <div className="overflow-hidden rounded-[28px] bg-[#0a3733] p-7 text-white shadow-[0_24px_60px_-28px_rgba(7,41,39,0.6)] sm:p-9">
      <div className="text-xs font-bold uppercase tracking-wider text-teal-200">Your appointment</div>
      <div className="mt-1 text-3xl font-extrabold sm:text-4xl">{formatPktWhen(startIso, nowMs)}</div>
      <div className="mt-0.5 text-sm text-teal-100/80">Pakistan time</div>

      <div className="mt-6 rounded-2xl bg-white/10 p-5">
        <div className="text-sm text-teal-100/90">
          {who === "patient" ? "Joining opens in" : "You can open the call in"}
        </div>
        <div className="mt-1 text-4xl font-extrabold tabular-nums text-[#ffb454]" aria-live="polite">
          {formatCountdown(msUntilOpen)}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-teal-100/80">
          {who === "patient"
            ? `The Join button appears ${opensMinutesBefore} minutes before your start time. Keep this page open — it will switch on by itself, and your doctor will see that you are here.`
            : `The call opens ${opensMinutesBefore} minutes before the start time. Keep this page open — it will switch on by itself, and the patient will see that you are here.`}
        </p>
      </div>
    </div>
  );
}
