"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 8, step 2: the doctor's side of self-service slot booking for
// audio/video consultations (Section 35). Manual, one slot at a time,
// per the physician's own choice (2026-09-12) — a recurring-pattern
// generator can be added later if this turns out to be a hassle.

interface SlotRow {
  id: string;
  start_time: string;
  capacity: number;
}

interface TextAvailabilityRow {
  start_time: string; // "HH:MM:SS"
  end_time: string;
  daily_limit: number;
}

// Text-consultation capacity (2026-09-14): a single daily window +
// limit, separate from the discrete video/audio slots above — text is
// asynchronous, not a scheduled meeting, so there's no list of times to
// pick from, just "when am I generally available to respond, and how
// many can I take per day." Evaluated in Pakistan time (Asia/Karachi)
// regardless of where the doctor or patient happen to be — see
// supabase/migrations/0031_doctor_text_availability.sql. No row here at
// all = unrestricted, exactly like before this feature existed.
function toHHMM(t: string): string {
  return t.slice(0, 5);
}

export default function DoctorAvailability() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();

  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [bookedCounts, setBookedCounts] = useState<Record<string, number> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newDate, setNewDate] = useState("");
  const [newCapacity, setNewCapacity] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [textAvailability, setTextAvailability] = useState<TextAvailabilityRow | null | undefined>(undefined);
  // Pre-filled to the platform's own standard hours (2026-09-15) — a
  // doctor can narrow these, but the database itself won't accept
  // anything outside 8:00 AM-11:00 PM Pakistan time.
  const [textStart, setTextStart] = useState("08:00");
  const [textEnd, setTextEnd] = useState("23:00");
  const [textLimit, setTextLimit] = useState("20");
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);

    const [slotsRes, bookingsRes, textRes] = await Promise.all([
      supabase
        .from("doctor_availability_slots")
        .select("id, start_time, capacity")
        .eq("doctor_id", session.user.id)
        .order("start_time", { ascending: true }),
      supabase.from("consultations").select("slot_id").not("slot_id", "is", null),
      supabase
        .from("doctor_text_availability")
        .select("start_time, end_time, daily_limit")
        .eq("doctor_id", session.user.id)
        .maybeSingle(),
    ]);

    if (slotsRes.error) {
      setLoadError(slotsRes.error.message);
      return;
    }
    setSlots(slotsRes.data as SlotRow[]);

    if (bookingsRes.error) {
      setLoadError(bookingsRes.error.message);
      return;
    }
    const counts: Record<string, number> = {};
    for (const row of bookingsRes.data as { slot_id: string }[]) {
      counts[row.slot_id] = (counts[row.slot_id] ?? 0) + 1;
    }
    setBookedCounts(counts);

    if (!textRes.error) {
      const row = textRes.data as TextAvailabilityRow | null;
      setTextAvailability(row);
      if (row) {
        setTextStart(toHHMM(row.start_time));
        setTextEnd(toHHMM(row.end_time));
        setTextLimit(String(row.daily_limit));
      }
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function addSlot() {
    if (!supabase || !session || !newDate) return;
    setCreating(true);
    setCreateError(null);

    const capacityNum = parseInt(newCapacity, 10);
    const { error: insertError } = await supabase.from("doctor_availability_slots").insert({
      doctor_id: session.user.id,
      start_time: new Date(newDate).toISOString(),
      capacity: Number.isFinite(capacityNum) && capacityNum > 0 ? capacityNum : 1,
    });

    setCreating(false);
    if (insertError) {
      setCreateError(insertError.message);
      return;
    }
    setNewDate("");
    setNewCapacity("1");
    load();
  }

  async function saveTextAvailability() {
    if (!supabase || !session) return;
    setTextError(null);
    const limitNum = parseInt(textLimit, 10);
    if (!textStart || !textEnd) {
      setTextError("Please set both a start and end time.");
      return;
    }
    if (textStart >= textEnd) {
      setTextError("End time must be after start time (an overnight window isn't supported yet).");
      return;
    }
    if (textStart < "08:00" || textEnd > "23:00") {
      setTextError("Text hours must fall within the platform's standard 8:00 AM–11:00 PM window (Pakistan time).");
      return;
    }
    if (!Number.isFinite(limitNum) || limitNum < 1) {
      setTextError("Please enter a daily limit of at least 1.");
      return;
    }
    setSavingText(true);
    const { error } = await supabase.from("doctor_text_availability").upsert(
      {
        doctor_id: session.user.id,
        start_time: textStart,
        end_time: textEnd,
        daily_limit: limitNum,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "doctor_id" }
    );
    setSavingText(false);
    if (error) {
      setTextError(error.message);
      return;
    }
    load();
  }

  async function clearTextAvailability() {
    if (!supabase || !session) return;
    setSavingText(true);
    setTextError(null);
    const { error } = await supabase.from("doctor_text_availability").delete().eq("doctor_id", session.user.id);
    setSavingText(false);
    if (error) {
      setTextError(error.message);
      return;
    }
    setTextAvailability(null);
    load();
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="availability">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
      </DoctorShell>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <DoctorShell active="availability">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  if (!session) {
    return (
      <DoctorShell active="availability">
        <div className="mx-auto max-w-md rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
          <p>Please log in with your doctor account first.</p>
          <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
            Doctor log in
          </Link>
        </div>
      </DoctorShell>
    );
  }

  if (profileError) {
    return (
      <DoctorShell active="availability">
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }

  if (!profile) {
    return (
      <DoctorShell active="availability">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <div className="mt-4 flex gap-4">
            <button onClick={() => signOut()} className="font-semibold text-teal-700 underline underline-offset-2">
              Log out
            </button>
            <Link href="/doctor/login" className="font-semibold text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </DoctorShell>
    );
  }

  if (loadError) {
    return (
      <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load your availability: {loadError}
        </div>
      </DoctorShell>
    );
  }

  if (slots === null || bookedCounts === null) {
    return (
      <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  const now = Date.now();
  const upcoming = slots.filter((s) => new Date(s.start_time).getTime() >= now);
  const past = slots.filter((s) => new Date(s.start_time).getTime() < now);

  return (
    <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
        Availability
      </h1>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-ink-900">Add a time slot</h2>
          <p className="mt-1 text-xs text-ink-500">
            Shared for both audio and video consultations — a block of your time, not tied to
            one call type. Set a capacity above 1 if you&rsquo;re happy to take more than one
            patient at that time.
          </p>

          {createError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-700">Date &amp; time</label>
              <input
                type="datetime-local"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 rounded-lg border border-ink-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-700">Capacity</label>
              <input
                type="number"
                min={1}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                className="mt-1 w-20 rounded-lg border border-ink-border px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={addSlot}
              disabled={creating || !newDate}
              className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Adding…" : "Add slot"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-ink-900">Text consultations</h2>
          <p className="mt-1 text-xs text-ink-500">
            Separate from the time slots — text has no scheduled meeting time, so instead set the
            daily window you&rsquo;re available to respond and a maximum number per day (Pakistan
            time). The platform is closed for text 11 PM–8 AM for every doctor regardless; leave
            this unset to use those standard hours with no daily limit.
          </p>

          {textError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{textError}</div>
          )}

          {textAvailability === undefined ? (
            <p className="mt-3 text-sm text-ink-400">Loading…</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-700">From</label>
                  <input
                    type="time"
                    min="08:00"
                    max="23:00"
                    value={textStart}
                    onChange={(e) => setTextStart(e.target.value)}
                    className="mt-1 rounded-lg border border-ink-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-700">To</label>
                  <input
                    type="time"
                    min="08:00"
                    max="23:00"
                    value={textEnd}
                    onChange={(e) => setTextEnd(e.target.value)}
                    className="mt-1 rounded-lg border border-ink-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-700">Max per day</label>
                  <input
                    type="number"
                    min={1}
                    value={textLimit}
                    onChange={(e) => setTextLimit(e.target.value)}
                    className="mt-1 w-24 rounded-lg border border-ink-border px-3 py-2 text-sm"
                  />
                </div>
                <button
                  onClick={saveTextAvailability}
                  disabled={savingText}
                  className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingText ? "Saving…" : textAvailability ? "Update" : "Set availability"}
                </button>
                {textAvailability && (
                  <button
                    onClick={clearTextAvailability}
                    disabled={savingText}
                    className="text-xs font-semibold text-red-700 underline underline-offset-2 disabled:opacity-50"
                  >
                    Remove limit (go back to unlimited)
                  </button>
                )}
              </div>
              {textAvailability ? (
                <p className="mt-3 text-xs font-semibold text-teal-700">
                  Currently: available {toHHMM(textAvailability.start_time)}–{toHHMM(textAvailability.end_time)},
                  up to {textAvailability.daily_limit}/day.
                </p>
              ) : (
                <p className="mt-3 text-xs text-ink-500">
                  Currently: the platform&rsquo;s standard hours apply — available 8:00 AM–11:00 PM, no daily limit.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* Slot lists as tables, not stacked cards (2026-09-20 — same
          density change as the consultation queue), so a doctor with
          many upcoming slots can scan them quickly. */}
      <section className="mt-7">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
          Upcoming slots
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No upcoming slots yet — add one above.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-ink-border bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink-border bg-[var(--background)] text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-3">Date &amp; time</th>
                  <th className="px-4 py-3 text-right">Booked</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((s) => {
                  const booked = bookedCounts[s.id] ?? 0;
                  const full = booked >= s.capacity;
                  return (
                    <tr key={s.id} className="border-b border-ink-border last:border-b-0">
                      <td className="px-4 py-3 font-semibold text-ink-900">
                        {new Date(s.start_time).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            full ? "bg-[var(--background)] text-ink-500" : "bg-teal-50 text-teal-800"
                          }`}
                        >
                          {booked} / {s.capacity}{full ? " · full" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
            Past slots
          </h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-ink-border bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {past.map((s) => (
                  <tr key={s.id} className="border-b border-ink-border text-ink-400 last:border-b-0">
                    <td className="px-4 py-3">
                      {new Date(s.start_time).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">{bookedCounts[s.id] ?? 0} / {s.capacity} booked</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </DoctorShell>
  );
}
