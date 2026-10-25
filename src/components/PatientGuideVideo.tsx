"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The patient booking guide (4:42, narrated, with on-screen captions) shown on
// /how-it-works. One video, two jump buttons: "Without an account" (guest
// booking) and "With an account". The file only downloads when someone presses
// play or a chapter button (preload="none" + a poster image), so the page stays
// light on mobile data.

const CHAPTERS = [
  { key: "guest", label: "Without an account", hint: "Book as a guest in about a minute", start: 14 },
  { key: "account", label: "With an account", hint: "Family members and every consultation in one place", start: 129 },
] as const;

export default function PatientGuideVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const applyPending = useCallback(() => {
    const v = ref.current;
    if (!v || pendingSeek.current === null) return;
    v.currentTime = pendingSeek.current;
    pendingSeek.current = null;
    void v.play().catch(() => {});
  }, []);

  function jump(start: number, key: string) {
    const v = ref.current;
    if (!v) return;
    setActive(key);
    if (v.readyState >= 1) {
      v.currentTime = start;
      void v.play().catch(() => {});
    } else {
      // Metadata not loaded yet (preload="none"): load it, then seek and play.
      pendingSeek.current = start;
      v.load();
    }
  }

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.addEventListener("loadedmetadata", applyPending);
    return () => v.removeEventListener("loadedmetadata", applyPending);
  }, [applyPending]);

  // Highlight whichever chapter the video is currently in.
  function onTime() {
    const v = ref.current;
    if (!v) return;
    const t = v.currentTime;
    const cur = [...CHAPTERS].reverse().find((c) => t >= c.start - 0.5);
    setActive(cur ? cur.key : null);
  }

  return (
    <section className="mt-10" aria-labelledby="guide-heading" data-testid="patient-guide">
      <h2 id="guide-heading" className="text-xl font-extrabold text-ink-900">
        Prefer to watch? See both ways to book
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
        A short guide (about 4½ minutes) showing how to book a consultation without an account, and with one. The
        screens are the real app, with sample names.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {CHAPTERS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => jump(c.start, c.key)}
            aria-pressed={active === c.key}
            data-testid={`chapter-${c.key}`}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              active === c.key
                ? "border-[#0a3733] bg-[#0a3733] text-white"
                : "border-[#d7e7e2] bg-white text-ink-900 hover:border-teal-600"
            }`}
          >
            <span className="block text-sm font-extrabold">▶ {c.label}</span>
            <span className={`mt-0.5 block text-xs ${active === c.key ? "text-teal-100" : "text-ink-500"}`}>{c.hint}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-3xl bg-[#0a3733] shadow-[0_14px_36px_-22px_rgba(7,41,39,0.55)]">
        <video
          ref={ref}
          controls
          playsInline
          preload="none"
          poster="/patient-booking-guide-poster.jpg"
          onTimeUpdate={onTime}
          className="block h-auto w-full"
          data-testid="patient-guide-video"
        >
          <source src="/patient-booking-guide.mp4" type="video/mp4" />
          Your browser can&rsquo;t play this video.
        </video>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Narrated in English with on-screen captions. Booking online is not for emergencies &mdash; if it is an
        emergency, go to the nearest emergency room.
      </p>
    </section>
  );
}
