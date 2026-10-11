"use client";

// "The other person is here / not here yet" banner for the call pages
// (2026-10-11). Display-only; fed by useCallPresence.

export default function CallPresenceBanner({
  otherWaiting,
  who,
}: {
  otherWaiting: boolean;
  who: "doctor" | "patient";
}) {
  // `who` is the person VIEWING this banner; the message is about the other side.
  const other = who === "patient" ? "Your doctor" : "The patient";
  if (otherWaiting) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-5 py-3.5 text-sm font-bold text-emerald-900 ring-1 ring-emerald-200">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        {other} is in the waiting room — you can start now.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3.5 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
      Waiting for {other.toLowerCase()} to join. Stay on this page — you will see it here the moment they arrive.
    </div>
  );
}
