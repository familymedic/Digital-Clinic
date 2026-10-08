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
  "from-teal-500 to-teal-700",
  "from-indigo-500 to-indigo-700",
  "from-amber-500 to-amber-700",
  "from-rose-500 to-rose-700",
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

  return (
    <div>
      <PageHeader
        title="Our Doctors"
        subtitle="PMDC-verified physicians, by department. Pick a doctor to book with directly."
      />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load doctors: {error}
          </div>
        )}

        {doctors === null && !error && <p className="text-sm text-ink-500">Loading…</p>}

        {doctors && doctors.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
            No doctors are listed yet — check back soon.
          </div>
        )}

        {doctors && doctors.length > 0 && (
          <>
            {availability && (
              <div className="mb-6 rounded-2xl border border-ink-border bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-ink-900">Find a doctor who is available</div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-ink-500">When do you need one?</div>
                    <div className="flex flex-wrap gap-2">
                      {URGENCY_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => setUrgency(o.value)}
                          className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            urgency === o.value
                              ? "border-teal-700 bg-teal-700 text-white"
                              : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-ink-500">How would you like to consult?</div>
                    <div className="flex flex-wrap gap-2">
                      {MODE_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => setMode(o.value)}
                          className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            mode === o.value
                              ? "border-teal-700 bg-teal-700 text-white"
                              : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                  Availability is based on each doctor&rsquo;s published hours and open slots (Pakistan time), not
                  whether they are online this second. &ldquo;Now&rdquo; means text is open, or an audio/video slot
                  starts within {NOW_WINDOW_MINUTES / 60} hours. For anything urgent or an emergency, call 1122.
                </p>
              </div>
            )}

            {filterActive && visible.length === 0 && (
              <div className="mb-6 rounded-2xl border border-dashed border-ink-border bg-white p-6 text-center text-sm text-ink-600">
                No doctors match that right now. Try &ldquo;Today&rdquo; or &ldquo;This week&rdquo;, or switch the
                consultation type.
              </div>
            )}

            <div className="mb-8 flex flex-wrap gap-2">
              {["All", ...specialties].map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSpecialty(s)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                    activeSpecialty === s
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((d, i) => (
                <div
                  key={d.id}
                  className="flex flex-col rounded-2xl border border-ink-border bg-white p-5 shadow-sm"
                >
                  <Link href={`/doctors/${d.id}`} className="flex items-center gap-3">
                    {d.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.profile_photo_url}
                        alt={d.full_name}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[i % AVATAR_TONES.length]} text-sm font-bold text-white`}
                      >
                        {initials(d.full_name)}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold text-ink-900 hover:text-teal-700">{d.full_name}</div>
                      <div className="text-xs text-ink-500">
                        {d.specialty ?? "General Practice"}
                        {d.years_of_experience != null && <> · {d.years_of_experience} yrs experience</>}
                      </div>
                      {d.credentials && <div className="mt-0.5 text-xs font-semibold text-teal-800">{d.credentials}</div>}
                    </div>
                  </Link>

                  <div className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800">
                    ✓ PMDC Verified
                  </div>

                  {availability?.[d.id] && (() => {
                    const a = availability[d.id];
                    return (
                      <div className="mt-3 space-y-1 text-xs">
                        {a.daily_full ? (
                          <div className="font-semibold text-amber-700">
                            Fully booked for today &mdash; bookings reopen tomorrow
                          </div>
                        ) : (
                          <>
                            <div className={a.text_open_now ? "font-semibold text-teal-800" : "text-ink-500"}>
                              {a.text_open_now
                                ? `Text: open now${a.text_spots_left !== null ? ` · ${a.text_spots_left} spot${a.text_spots_left === 1 ? "" : "s"} left today` : ""}`
                                : a.text_opens_in_minutes !== null
                                  ? `Text: opens in ${formatMinutes(a.text_opens_in_minutes)}`
                                  : "Text: closed for today"}
                            </div>
                            <div className={a.next_call_start ? "text-ink-700" : "text-ink-500"}>
                              {a.next_call_start
                                ? `Audio/Video: next slot ${formatCallTime(a.next_call_start)}`
                                : "Audio/Video: no open slots"}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {d.bio && <p className="mt-3 line-clamp-3 text-xs text-ink-600">{d.bio}</p>}

                  <Link
                    href={`/doctors/${d.id}`}
                    className="mt-3 w-fit text-xs font-semibold text-teal-700 hover:text-teal-800"
                  >
                    View full profile →
                  </Link>

                  <div className="mt-4 text-sm text-ink-700">
                    Consultation fee: <span className="font-semibold text-ink-900">PKR {d.consultation_fee ?? "—"}</span>
                  </div>

                  <Link
                    href={`/book?doctorId=${d.id}`}
                    className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                  >
                    Book a consultation
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
