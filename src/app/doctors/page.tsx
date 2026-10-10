"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Doctor onboarding, step 3: a public doctor directory — patients can
// see and choose a doctor by department before booking, per the
// physician's explicit request. Reads from `public_doctor_directory`
// (0028), a view exposing only safe columns (name, specialty, fee) for
// doctors who are actually approved/active/fee-approved — never the
// full doctor_profiles table, which also holds PMDC numbers and
// certificate paths that have no business being public. No login
// required to view this page, matching the very first ask in this
// project's redesign conversation: "there should be some doctor profile
// on front page."

// Doctor public profile (2026-09-15): the view now also carries bio,
// years_of_experience, and profile_photo_url — each null unless that
// doctor has submitted a profile AND an admin approved it (0034), so a
// doctor who hasn't gotten there yet just falls back to the same
// initials-avatar / fee-only card as before.

interface DirectoryDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  bio: string | null;
  years_of_experience: number | null;
  credentials: string | null;
  profile_photo_url: string | null;
}

// "Who is available" filter (2026-10-04, physician's request): reads one
// extra RPC, list_available_doctors() (0059), which only COMBINES the
// existing text-window / audio-video-slot / daily-cap checks — it adds
// no rule of its own. "Available" means open per the doctor's own
// published hours and slots, NOT live online status (the app has no
// presence tracking). Fails soft: if the RPC isn't there yet (migration
// not run) or errors, `availability` stays null, the filter bar is
// hidden, and this page behaves exactly as it did before this feature.
interface Availability {
  doctor_id: string;
  daily_full: boolean;
  text_open_now: boolean;
  text_opens_in_minutes: number | null;
  text_spots_left: number | null;
  next_call_start: string | null;
  next_call_minutes: number | null;
  next_call_spots: number | null;
  call_slots_today: number;
  call_slots_week: number;
}

type Urgency = "any" | "now" | "today" | "week";
type Mode = "any" | "text" | "call";

// "Now" for a call means a slot starting within this many minutes.
const NOW_WINDOW_MINUTES = 120;

const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "now", label: "Now" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
];

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "any", label: "Any type" },
  { value: "text", label: "Text" },
  { value: "call", label: "Audio / Video" },
];

function textMatches(a: Availability, urgency: Urgency): boolean {
  // Text is a recurring daily window, so "this week" is true for every
  // doctor; "now"/"today" also respect today's daily patient ceiling.
  if (urgency === "week") return true;
  if (a.daily_full) return false;
  if (urgency === "now") return a.text_open_now;
  return a.text_open_now || a.text_opens_in_minutes !== null;
}

function callMatches(a: Availability, urgency: Urgency): boolean {
  if (urgency === "week") return a.call_slots_week > 0;
  if (a.daily_full) return false;
  if (urgency === "now") {
    return a.next_call_minutes !== null && a.next_call_minutes <= NOW_WINDOW_MINUTES;
  }
  return a.call_slots_today > 0;
}

function matchesFilter(a: Availability, urgency: Urgency, mode: Mode): boolean {
  if (urgency === "any") {
    // No time constraint: "Audio / Video" still means "has at least one
    // open slot at all"; Text and Any type don't narrow anything.
    return mode === "call" ? a.next_call_minutes !== null : true;
  }
  const textOk = mode !== "call" && textMatches(a, urgency);
  const callOk = mode !== "text" && callMatches(a, urgency);
  return textOk || callOk;
}

// Minutes until this doctor can take the patient in the chosen mode;
// smaller sorts first. Text that only reopens tomorrow counts as a day.
function soonestMinutes(a: Availability, mode: Mode): number {
  const candidates: number[] = [];
  if (mode !== "call") {
    if (a.text_open_now && !a.daily_full) candidates.push(0);
    else if (a.text_opens_in_minutes !== null && !a.daily_full) candidates.push(a.text_opens_in_minutes);
    else candidates.push(24 * 60);
  }
  if (mode !== "text" && a.next_call_minutes !== null) {
    candidates.push(a.next_call_minutes);
  }
  if (!candidates.length) return Number.MAX_SAFE_INTEGER;
  const soonest = Math.min(...candidates);
  // The daily patient ceiling (0033) counts bookings CREATED today, so a
  // doctor who has hit it can't take any new booking until tomorrow —
  // even for a slot that starts in 30 minutes. Sort them after everyone
  // who can actually be booked now.
  return a.daily_full ? Math.max(soonest, 24 * 60) : soonest;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function pktDateKey(d: Date): string {
  // en-CA formats as YYYY-MM-DD, handy for same-day comparison.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}

function formatCallTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (pktDateKey(d) === pktDateKey(now)) return `Today ${time}`;
  if (pktDateKey(d) === pktDateKey(tomorrow)) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
  }).format(d);
  return `${day}, ${time}`;
}

const AVATAR_TONES = [
  "from-teal-300 to-teal-700",
  "from-emerald-300 to-emerald-700",
  "from-cyan-300 to-teal-600",
  "from-amber-300 to-amber-600",
  "from-sky-300 to-sky-700",
];

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DoctorDirectory() {
  const [doctors, setDoctors] = useState<DirectoryDoctor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSpecialty, setActiveSpecialty] = useState<string>("All");
  const [availability, setAvailability] = useState<Record<string, Availability> | null>(null);
  const [urgency, setUrgency] = useState<Urgency>("any");
  const [mode, setMode] = useState<Mode>("any");

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    (async () => {
      const base = "id, full_name, specialty, consultation_fee, bio, years_of_experience, profile_photo_url";
      // `credentials` arrives with migration 0067; if it isn't applied yet,
      // fall back to the old column set so the directory never breaks.
      let res: { data: unknown; error: { message: string } | null } = await client
        .from("public_doctor_directory")
        .select(`${base}, credentials`)
        .order("full_name", { ascending: true });
      if (res.error && /credentials/.test(res.error.message)) {
        res = await client.from("public_doctor_directory").select(base).order("full_name", { ascending: true });
      }
      if (res.error) {
        setError(res.error.message);
      } else {
        setDoctors(res.data as unknown as DirectoryDoctor[]);
      }
    })();
  }, []);

  // Availability: a separate, fail-soft read (see the comment on the
  // Availability type). Refreshed every minute so "Now" stays honest
  // while the page is left open. Any error just leaves availability
  // null, which hides the filter and keeps the page as it was.
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    async function load() {
      const { data, error: rpcError } = await client!.rpc("list_available_doctors");
      if (cancelled || rpcError || !data) return;
      const map: Record<string, Availability> = {};
      for (const row of data as Availability[]) map[row.doctor_id] = row;
      setAvailability(map);
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const specialties = useMemo(() => {
    if (!doctors) return [];
    return Array.from(new Set(doctors.map((d) => d.specialty ?? "Other"))).sort();
  }, [doctors]);

  const filterActive = availability !== null && (urgency !== "any" || mode !== "any");

  const visible = useMemo(() => {
    if (!doctors) return [];
    let list =
      activeSpecialty === "All"
        ? doctors
        : doctors.filter((d) => (d.specialty ?? "Other") === activeSpecialty);
    if (availability && (urgency !== "any" || mode !== "any")) {
      // A doctor with no availability row (shouldn't happen, but never
      // crash on it) is treated as not matching rather than hidden by
      // accident while no filter is on.
      list = list
        .filter((d) => {
          const a = availability[d.id];
          return a ? matchesFilter(a, urgency, mode) : false;
        })
        .sort((x, y) => {
          const ax = availability[x.id];
          const ay = availability[y.id];
          const diff = soonestMinutes(ax, mode) - soonestMinutes(ay, mode);
          return diff !== 0 ? diff : x.full_name.localeCompare(y.full_name);
        });
    }
    return list;
  }, [doctors, activeSpecialty, availability, urgency, mode]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Our Doctors" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  const pill = (on: boolean) =>
    `rounded-full px-4 py-2 text-[13px] font-extrabold transition ${
      on ? "bg-teal-700 text-white shadow-md shadow-teal-900/25" : "text-ink-700 hover:bg-white hover:text-teal-800"
    }`;

  return (
    <div>
      {/* New look (2026-10): dark hero + overlapping filter card. Only
          the layout/styling changed — every filter, sort and booking
          link below behaves exactly as before. */}
      <section className="bg-[radial-gradient(800px_380px_at_88%_0%,#0f766e_0%,#0a3733_58%,#072927_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-teal-200">Our doctors</span>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">Meet your doctors.</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-teal-50/90 sm:text-lg">
            PMDC-verified physicians, by department. Pick a doctor and book with them directly.
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-14 max-w-6xl px-4 pb-16 sm:px-6">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load doctors: {error}
          </div>
        )}

        {doctors === null && !error && <p className="rounded-2xl bg-white p-5 text-sm text-ink-500 shadow-sm">Loading…</p>}

        {doctors && doctors.length === 0 && (
          <div className="rounded-3xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
            No doctors are listed yet — check back soon.
          </div>
        )}

        {doctors && doctors.length > 0 && (
          <>
            {availability && (
              <div className="mb-6 rounded-[30px] bg-white p-5 shadow-[0_24px_50px_rgba(10,55,51,0.12)] sm:p-7">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-2.5 text-lg font-extrabold text-ink-900">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="4" y="5" width="16" height="15" rx="2" />
                      <path d="M8 3v4M16 3v4M4 10h16" />
                    </svg>
                    Find a doctor who is available
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:gap-9">
                  <div>
                    <div className="mb-2 text-xs font-extrabold text-ink-500">When do you need one?</div>
                    <div className="flex flex-wrap gap-0.5 rounded-full bg-[var(--background)] p-1">
                      {URGENCY_OPTIONS.map((o) => (
                        <button key={o.value} onClick={() => setUrgency(o.value)} className={pill(urgency === o.value)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-extrabold text-ink-500">How would you like to consult?</div>
                    <div className="flex flex-wrap gap-0.5 rounded-full bg-[var(--background)] p-1">
                      {MODE_OPTIONS.map((o) => (
                        <button key={o.value} onClick={() => setMode(o.value)} className={pill(mode === o.value)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
                  Availability is based on each doctor&rsquo;s published hours and open slots (Pakistan time), not
                  whether they are online this second. &ldquo;Now&rdquo; means text is open, or an audio/video slot
                  starts within {NOW_WINDOW_MINUTES / 60} hours. For anything urgent or an emergency, call 1122.
                </p>
              </div>
            )}

            {filterActive && visible.length === 0 && (
              <div className="mb-6 rounded-3xl border border-dashed border-ink-border bg-white p-6 text-center text-sm text-ink-600">
                No doctors match that right now. Try &ldquo;Today&rdquo; or &ldquo;This week&rdquo;, or switch the
                consultation type.
              </div>
            )}

            <div className="mb-6 flex flex-wrap gap-2">
              {["All", ...specialties].map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSpecialty(s)}
                  className={`rounded-full px-5 py-2.5 text-[13px] font-extrabold transition ${
                    activeSpecialty === s
                      ? "bg-[#0a3733] text-white"
                      : "border border-[#d6e5e1] bg-white text-ink-700 hover:border-teal-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mb-5 text-xl font-extrabold text-ink-900">
              {visible.length} doctor{visible.length === 1 ? "" : "s"}
              {filterActive && <span className="ml-2 text-sm font-semibold text-ink-500">· soonest available first</span>}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((d, i) => (
                <div
                  key={d.id}
                  className="flex flex-col rounded-[28px] bg-white p-6 shadow-[0_10px_30px_rgba(10,55,51,0.07)]"
                >
                  <Link href={`/doctors/${d.id}`} className="flex items-center gap-4">
                    {d.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.profile_photo_url}
                        alt={d.full_name}
                        className="h-[68px] w-[68px] shrink-0 rounded-[22px] object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br ${AVATAR_TONES[i % AVATAR_TONES.length]} text-xl font-extrabold text-[#0a3733]`}
                      >
                        {initials(d.full_name)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[17.5px] font-extrabold text-ink-900 hover:text-teal-700">{d.full_name}</div>
                      <div className="text-[13.5px] text-ink-500">
                        {d.specialty ?? "General Practice"}
                        {d.years_of_experience != null && <> · {d.years_of_experience} yrs experience</>}
                      </div>
                      {d.credentials && <div className="mt-0.5 text-[13px] font-bold text-teal-700">{d.credentials}</div>}
                    </div>
                  </Link>

                  <div className="mt-3.5 inline-flex w-fit items-center gap-1 rounded-full bg-teal-50 px-3 py-1.5 text-[11.5px] font-extrabold text-teal-800">
                    ✓ PMDC verified
                  </div>

                  {availability?.[d.id] && (() => {
                    const a = availability[d.id];
                    return (
                      <div
                        className={`mt-3.5 space-y-1.5 rounded-2xl px-3.5 py-3 text-[13px] ${a.daily_full ? "bg-amber-50" : "bg-[#f4fbf8]"}`}
                      >
                        {a.daily_full ? (
                          <div className="font-bold text-amber-800">
                            Fully booked for today &mdash; bookings reopen tomorrow
                          </div>
                        ) : (
                          <>
                            <div className={`flex items-center gap-2 ${a.text_open_now ? "font-bold text-emerald-800" : "text-ink-500"}`}>
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${a.text_open_now ? "bg-emerald-500" : a.text_opens_in_minutes !== null ? "bg-amber-500" : "bg-slate-400"}`}
                              />
                              {a.text_open_now
                                ? `Text: open now${a.text_spots_left !== null ? ` · ${a.text_spots_left} spot${a.text_spots_left === 1 ? "" : "s"} left today` : ""}`
                                : a.text_opens_in_minutes !== null
                                  ? `Text: opens in ${formatMinutes(a.text_opens_in_minutes)}`
                                  : "Text: closed for today"}
                            </div>
                            <div className={`flex items-center gap-2 ${a.next_call_start ? "font-semibold text-ink-700" : "text-ink-500"}`}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                                <rect x="3" y="6" width="13" height="12" rx="2" />
                                <path d="M16 10l5-3v10l-5-3z" />
                              </svg>
                              {a.next_call_start
                                ? `Audio/Video: next slot ${formatCallTime(a.next_call_start)}`
                                : "Audio/Video: no open slots"}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {d.bio && <p className="mt-3.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-500">{d.bio}</p>}

                  <div className="mt-auto pt-5">
                    <div className="flex items-end justify-between border-t border-[#e6efec] pt-4">
                      <div>
                        <div className="text-[11.5px] font-bold text-ink-500">Consultation fee</div>
                        <div className="text-xl font-extrabold text-ink-900">PKR {d.consultation_fee ?? "—"}</div>
                      </div>
                      <Link
                        href={`/doctors/${d.id}`}
                        className="text-[13px] font-extrabold text-teal-700 hover:text-teal-800"
                      >
                        View profile →
                      </Link>
                    </div>
                    <Link
                      href={`/book?doctorId=${d.id}`}
                      className="mt-3.5 block rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-3 text-center text-sm font-extrabold text-white shadow-md shadow-teal-900/20 transition hover:from-teal-700 hover:to-teal-800"
                    >
                      Book now
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
