"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// Homepage hero card that rotates through the doctors registered on the
// platform, one every 3 seconds (physician, 2026-10: "the doctors
// registered should rotate on the first screen ... so it remains
// attractive").
//
// Read-only and fail-soft, in the same spirit as the other homepage
// widgets (SponsoredAdSlot, FeaturedReviews):
// - Doctors come from `public_doctor_directory` (0028) — the same view
//   the /doctors page reads, so only approved/active/fee-approved
//   doctors ever appear, and only its safe public columns.
// - "Next available" comes from the existing RPC list_available_doctors
//   (0059). If it isn't there or errors, the card simply omits that
//   line. It adds no availability rule of its own.
// - If no doctor can be loaded (none registered yet, database not
//   connected, any error) a calm static card is shown instead, so the
//   hero never looks broken or empty.
// - The order is shuffled once per visit so no doctor is always first.
// - Rotation pauses while the card is hovered or focused, and is off
//   entirely for visitors who asked their device for reduced motion
//   (they can still tap the dots).

interface SpotDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  years_of_experience: number | null;
  credentials: string | null;
  profile_photo_url: string | null;
}

interface Avail {
  doctor_id: string;
  daily_full: boolean;
  text_open_now: boolean;
  next_call_start: string | null;
}

const ROTATE_MS = 3000;

const TONES = [
  "from-teal-300 to-teal-700",
  "from-emerald-300 to-emerald-700",
  "from-cyan-300 to-teal-600",
  "from-amber-300 to-amber-600",
  "from-sky-300 to-sky-700",
];

function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s*/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function pktDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}

function formatCallTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit" }).format(d);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (pktDateKey(d) === pktDateKey(now)) return `Today ${time}`;
  if (pktDateKey(d) === pktDateKey(tomorrow)) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" }).format(d);
  return `${day}, ${time}`;
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function HeroDoctorSpotlight() {
  const [doctors, setDoctors] = useState<SpotDoctor[] | null>(null);
  const [avail, setAvail] = useState<Record<string, Avail>>({});
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    (async () => {
      const base = "id, full_name, specialty, consultation_fee, years_of_experience, profile_photo_url";
      let res: { data: unknown; error: { message: string } | null } = await client
        .from("public_doctor_directory")
        .select(`${base}, credentials`)
        .limit(12);
      if (res.error && /credentials/.test(res.error.message)) {
        res = await client.from("public_doctor_directory").select(base).limit(12);
      }
      if (cancelled || res.error || !Array.isArray(res.data) || res.data.length === 0) return;
      setDoctors(shuffled(res.data as SpotDoctor[]));
    })();
    (async () => {
      try {
        const { data, error } = await client.rpc("list_available_doctors");
        if (cancelled || error || !Array.isArray(data)) return;
        const map: Record<string, Avail> = {};
        for (const row of data as Avail[]) map[row.doctor_id] = row;
        setAvail(map);
      } catch {
        // availability is optional; the card just omits that line
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      // ignore
    }
  }, []);

  const count = doctors?.length ?? 0;
  const rotating = count > 1 && !paused && !reduceMotion;

  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [rotating, index, count]);

  const doctor = useMemo(() => (doctors && doctors.length ? doctors[index % doctors.length] : null), [doctors, index]);

  const shell =
    "relative w-full max-w-md rounded-[32px] bg-white p-6 text-ink-900 shadow-[0_36px_70px_rgba(0,0,0,0.4)]";

  if (!doctor) {
    // Calm static fallback — never an empty box.
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-[17px] font-extrabold">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Meet our doctors
        </div>
        <div className="relative mt-4 flex h-36 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0a2e2b] to-[#123f3a]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-700 text-lg font-bold text-white">
            DR
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-500">Video, audio or text with a PMDC-verified family doctor.</p>
        <Link
          href="/doctors"
          className="mt-4 block rounded-2xl bg-[#0a3733] px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-[#0f4a44]"
        >
          See our doctors
        </Link>
      </div>
    );
  }

  const a = avail[doctor.id];
  let availLine: { text: string; tone: string } | null = null;
  if (a) {
    if (a.daily_full) availLine = { text: "Fully booked today", tone: "bg-amber-50 text-amber-800" };
    else if (a.text_open_now) availLine = { text: "Text open now", tone: "bg-emerald-50 text-emerald-800" };
    else if (a.next_call_start) availLine = { text: `Next: ${formatCallTime(a.next_call_start)}`, tone: "bg-amber-50 text-amber-800" };
  }

  return (
    <div
      className={shell}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Our doctors"
    >
      <style>{`@keyframes fmProg{from{width:0}to{width:100%}}@keyframes fmFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[17px] font-extrabold">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Meet our doctors
        </div>
        <span className="text-xs font-bold text-ink-500">
          {(index % count) + 1} / {count}
        </span>
      </div>

      <div key={doctor.id} className="mt-5 min-h-[168px]" style={reduceMotion ? undefined : { animation: "fmFade .45s ease both" }} aria-live="polite">
        <div className="flex items-center gap-4">
          {doctor.profile_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doctor.profile_photo_url} alt={doctor.full_name} className="h-16 w-16 shrink-0 rounded-[22px] object-cover" />
          ) : (
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br ${TONES[(index % count) % TONES.length]} text-xl font-extrabold text-[#0a3733]`}
            >
              {initials(doctor.full_name)}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold">{doctor.full_name}</div>
            <div className="text-[13.5px] text-ink-500">
              {doctor.specialty ?? "General Practice"}
              {doctor.years_of_experience != null && <> · {doctor.years_of_experience} yrs</>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-800">
                ✓ PMDC verified
              </span>
              {doctor.credentials && <span className="text-[12px] font-bold text-teal-800">{doctor.credentials}</span>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-[#f4fbf8] px-3.5 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Consultation</div>
            <div className="mt-0.5 text-base font-extrabold">PKR {doctor.consultation_fee ?? "—"}</div>
          </div>
          <div className={`rounded-2xl px-3.5 py-3 ${availLine ? availLine.tone : "bg-[#f4fbf8] text-ink-700"}`}>
            <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">Availability</div>
            <div className="mt-0.5 text-sm font-extrabold">{availLine ? availLine.text : "See profile"}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Choose a doctor">
        {doctors!.map((d, i) => {
          const active = i === index % count;
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`Show ${d.full_name}`}
              onClick={() => setIndex(i)}
              className="h-5 flex-1 py-2"
            >
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[#d6e5e1]">
                <span
                  key={active ? `a-${index}-${paused}` : `i-${i}`}
                  className="block h-full rounded-full bg-teal-700"
                  style={
                    i < index % count
                      ? { width: "100%" }
                      : active && rotating
                        ? { animation: `fmProg ${ROTATE_MS}ms linear forwards` }
                        : active
                          ? { width: "100%" }
                          : { width: 0 }
                  }
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2.5">
        <Link
          href={`/book?doctorId=${doctor.id}`}
          className="flex-1 rounded-2xl bg-[#0a3733] px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-[#0f4a44]"
        >
          Book with this doctor
        </Link>
        <Link
          href={`/doctors/${doctor.id}`}
          className="rounded-2xl border-2 border-[#0a3733]/15 px-4 py-3 text-center text-sm font-bold text-[#0a3733] transition hover:border-teal-700"
        >
          Profile
        </Link>
      </div>
    </div>
  );
}
