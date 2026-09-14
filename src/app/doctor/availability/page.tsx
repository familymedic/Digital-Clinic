"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
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
      <div>
        <PageHeader title="Availability" />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <div>
        <PageHeader title="Availability" />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Availability" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in with your doctor account first.</p>
            <Link href="/doctor/login" className="mt-4 inline-block font-medium text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div>
        <PageHeader title="Availability" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t verify your doctor account: {profileError}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader title="Availability" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>This account isn&rsquo;t set up as a doctor account.</p>
            <div className="mt-4 flex gap-4">
              <button onClick={() => signOut()} className="font-medium text-teal-700 underline underline-offset-2">
                Log out
              </button>
              <Link href="/doctor/login" className="font-medium text-teal-700 underline underline-offset-2">
                Doctor log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Availability" subtitle={`Signed in as ${profile.full_name}`} />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load your availability: {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (slots === null || bookedCounts === null) {
    return (
      <div>
        <PageHeader title="Availability" subtitle={`Signed in as ${profile.full_name}`} />
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const upcoming = slots.filter((s) => new Date(s.start_time).getTime() >= now);
  const past = slots.filter((s) => new Date(s.start_time).getTime() < now);

  return (
    <div>
      <PageHeader title="Availability" subtitle={`Signed in as ${profile.full_name}`} />
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:px-6">
        <Link href="/doctor" className="inline-block text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to dashboard
        </Link>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Add a time slot</h2>
          <p className="mt-1 text-xs text-slate-500">
            This is shared for both audio and video consultations — it&rsquo;s a block of your
            time, not tied to one call type. Set a capacity above 1 if you&rsquo;re happy to take
            more than one patient at that time.
          </p>

          {createError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Date &amp; time</label>
              <input
                type="datetime-local"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Capacity</label>
              <input
                type="number"
                min={1}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                className="mt-1 w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={addSlot}
              disabled={creating || !newDate}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Adding…" : "Add slot"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Text consultations</h2>
          <p className="mt-1 text-xs text-slate-500">
            Separate from the time slots above — text has no scheduled meeting time, so instead set the daily
            window you&rsquo;re available to respond and a maximum number per day. Times are Pakistan time. The
            platform is closed for text between 11 PM and 8 AM for every doctor; if you leave this unset, those
            standard hours apply automatically with no daily limit. Set your own hours below only if you want to
            narrow further (e.g. mornings only) or add a daily cap.
          </p>

          {textError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{textError}</div>
          )}

          {textAvailability === undefined ? (
            <p className="mt-3 text-sm text-slate-400">Loading…</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">From</label>
                  <input
                    type="time"
                    min="08:00"
                    max="23:00"
                    value={textStart}
                    onChange={(e) => setTextStart(e.target.value)}
                    className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">To</label>
                  <input
                    type="time"
                    min="08:00"
                    max="23:00"
                    value={textEnd}
                    onChange={(e) => setTextEnd(e.target.value)}
                    className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Max per day</label>
                  <input
                    type="number"
                    min={1}
                    value={textLimit}
                    onChange={(e) => setTextLimit(e.target.value)}
                    className="mt-1 w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  onClick={saveTextAvailability}
                  disabled={savingText}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingText ? "Saving…" : textAvailability ? "Update" : "Set availability"}
                </button>
                {textAvailability && (
                  <button
                    onClick={clearTextAvailability}
                    disabled={savingText}
                    className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                  >
                    Remove limit (go back to unlimited)
                  </button>
                )}
              </div>
              {textAvailability ? (
                <p className="mt-3 text-xs text-teal-700">
                  Currently: available {toHHMM(textAvailability.start_time)}–{toHHMM(textAvailability.end_time)},
                  up to {textAvailability.daily_limit}/day.
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Currently: the platform&rsquo;s standard hours apply — available 8:00 AM–11:00 PM, no daily limit.
                </p>
              )}
            </>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Upcoming slots
          </h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No upcoming slots yet — add one above.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((s) => {
                const booked = bookedCounts[s.id] ?? 0;
                const full = booked >= s.capacity;
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
                  >
                    <span className="font-medium text-slate-900">
                      {new Date(s.start_time).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        full ? "bg-slate-100 text-slate-500" : "bg-teal-50 text-teal-800"
                      }`}
                    >
                      {booked} / {s.capacity} booked{full ? " · full" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {past.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Past slots
            </h2>
            <ul className="mt-3 space-y-2">
              {past.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400"
                >
                  <span>
                    {new Date(s.start_time).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>{bookedCounts[s.id] ?? 0} / {s.capacity} booked</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
