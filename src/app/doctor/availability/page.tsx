"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  daily_limit: number | null; // null = no daily limit
  text_enabled: boolean; // master switch (0062)
  days_off: number[]; // ISO weekdays text is OFF on: 1 = Mon ... 7 = Sun (0062)
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---- Repeat-a-schedule helpers (2026-10-05) --------------------------
// Slots are stored as real instants (timestamptz). Pakistan has no
// daylight saving, so copying a slot to another day is just adding a
// whole number of 24-hour days to its instant: the clock time in
// Pakistan stays identical. All "which day / which week" decisions are
// made in Pakistan time (UTC+5) so they're right wherever the doctor's
// browser happens to be.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pktDayStart(ms: number): number {
  return Math.floor((ms + PKT_OFFSET_MS) / DAY_MS) * DAY_MS - PKT_OFFSET_MS;
}
function pktIsoWeekday(ms: number): number {
  const d = new Date(ms + PKT_OFFSET_MS).getUTCDay();
  return d === 0 ? 7 : d;
}
function pktMondayStart(ms: number): number {
  return pktDayStart(ms) - (pktIsoWeekday(ms) - 1) * DAY_MS;
}
function pktDateInputValue(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}
function parsePktDate(value: string): number | null {
  const ms = Date.parse(`${value}T00:00:00+05:00`);
  return Number.isFinite(ms) ? ms : null;
}
function fmtPkt(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
function weekLabel(mondayMs: number, offset: number): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" });
  const tag = offset === 0 ? " (this week)" : offset === 1 ? " (next week)" : offset === -1 ? " (last week)" : "";
  return `${f(mondayMs)} – ${f(mondayMs + 6 * DAY_MS)}${tag}`;
}

interface PlanItem {
  startMs: number;
  capacity: number;
  status: "new" | "exists" | "past";
}

function classify(
  candidates: { startMs: number; capacity: number }[],
  existing: Set<number>,
  nowMs: number
): PlanItem[] {
  const seen = new Set<number>();
  const items: PlanItem[] = [];
  for (const c of candidates) {
    if (seen.has(c.startMs)) continue;
    seen.add(c.startMs);
    items.push({
      ...c,
      status: c.startMs < nowMs ? "past" : existing.has(c.startMs) ? "exists" : "new",
    });
  }
  return items.sort((a, b) => a.startMs - b.startMs);
}

function planWeekRepeat(
  slots: SlotRow[],
  srcMonday: number,
  tgtMonday: number,
  days: number[],
  nowMs: number
): PlanItem[] {
  if (srcMonday === tgtMonday) return [];
  const existing = new Set(slots.map((s) => new Date(s.start_time).getTime()));
  const candidates = slots
    .map((s) => ({ ms: new Date(s.start_time).getTime(), capacity: s.capacity }))
    .filter((s) => s.ms >= srcMonday && s.ms < srcMonday + 7 * DAY_MS && days.includes(pktIsoWeekday(s.ms)))
    .map((s) => ({ startMs: s.ms + (tgtMonday - srcMonday), capacity: s.capacity }));
  return classify(candidates, existing, nowMs);
}

function planDayRepeat(
  slots: SlotRow[],
  srcDayStart: number,
  tgtDayStarts: number[],
  nowMs: number
): PlanItem[] {
  const existing = new Set(slots.map((s) => new Date(s.start_time).getTime()));
  const daySlots = slots
    .map((s) => ({ ms: new Date(s.start_time).getTime(), capacity: s.capacity }))
    .filter((s) => s.ms >= srcDayStart && s.ms < srcDayStart + DAY_MS);
  const candidates = tgtDayStarts
    .filter((t) => t !== srcDayStart)
    .flatMap((t) => daySlots.map((s) => ({ startMs: s.ms + (t - srcDayStart), capacity: s.capacity })));
  return classify(candidates, existing, nowMs);
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

  // Removing empty slots (2026-10-08). Two-step confirm, inline.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmClearPast, setConfirmClearPast] = useState(false);
  const [clearingPast, setClearingPast] = useState(false);
  const [slotNote, setSlotNote] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

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
  // Master on/off + off-weekdays (0062). Saved immediately on each click.
  const [textEnabled, setTextEnabled] = useState(true);
  const [textDaysOff, setTextDaysOff] = useState<number[]>([]);
  const [savingSwitch, setSavingSwitch] = useState(false);

  // Repeat a schedule (2026-10-05).
  const [repeatMode, setRepeatMode] = useState<"week" | "day">("week");
  const [srcWeekOffset, setSrcWeekOffset] = useState(0);
  const [tgtWeekOffset, setTgtWeekOffset] = useState(1);
  const [daysIncluded, setDaysIncluded] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [srcDate, setSrcDate] = useState("");
  const [tgtDates, setTgtDates] = useState<string[]>([]);
  const [tgtDateDraft, setTgtDateDraft] = useState("");
  const [repeating, setRepeating] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [repeatNote, setRepeatNote] = useState<string | null>(null);

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
        .select("start_time, end_time, daily_limit, text_enabled, days_off")
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
        setTextLimit(row.daily_limit != null ? String(row.daily_limit) : "");
        setTextEnabled(row.text_enabled);
        setTextDaysOff(row.days_off ?? []);
      } else {
        setTextEnabled(true);
        setTextDaysOff([]);
      }
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  // Delete ONE empty slot. A slot someone has booked can't be deleted:
  // the database refuses it (the patient's appointment points at it), and
  // we don't even offer the button for one. Slots are only ever removed
  // here when nobody has booked them.
  async function removeSlot(id: string) {
    if (!supabase || !session) return;
    setSlotNote(null);
    setSlotError(null);
    setRemovingId(id);
    const { data, error } = await supabase
      .from("doctor_availability_slots")
      .delete()
      .eq("id", id)
      .eq("doctor_id", session.user.id)
      .select("id");
    setRemovingId(null);
    setConfirmRemoveId(null);
    if (error) {
      setSlotError(
        /foreign key|violates/i.test(error.message)
          ? "That slot has a booking, so it was kept."
          : `Couldn't remove that slot: ${error.message}`
      );
    } else if (!data || data.length === 0) {
      setSlotError("Couldn't remove that slot. Please refresh and try again.");
    } else {
      setSlotNote("Slot removed.");
    }
    load();
  }

  // Delete every PAST slot that nobody booked. Booked ones are never
  // touched, so a patient's appointment history is never affected.
  async function clearEmptyPastSlots() {
    if (!supabase || !session || !slots || !bookedCounts) return;
    setSlotNote(null);
    setSlotError(null);
    setClearingPast(true);
    const nowMs = Date.now();
    const ids = slots
      .filter((s) => new Date(s.start_time).getTime() < nowMs && (bookedCounts[s.id] ?? 0) === 0)
      .map((s) => s.id);
    let removed = 0;
    let failed: string | null = null;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await supabase
        .from("doctor_availability_slots")
        .delete()
        .in("id", chunk)
        .eq("doctor_id", session.user.id)
        .select("id");
      if (error) {
        failed = error.message;
        break;
      }
      removed += data?.length ?? 0;
    }
    setClearingPast(false);
    setConfirmClearPast(false);
    if (failed) {
      setSlotError(`Removed ${removed}, then stopped: ${failed}`);
    } else {
      setSlotNote(removed === 1 ? "1 empty past slot removed." : `${removed} empty past slots removed.`);
    }
    load();
  }

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
    const noLimit = textLimit.trim() === "";
    if (!noLimit && (!Number.isFinite(limitNum) || limitNum < 1)) {
      setTextError("Please enter a daily limit of at least 1, or leave it blank for no limit.");
      return;
    }
    setSavingText(true);
    const { error } = await supabase.from("doctor_text_availability").upsert(
      {
        doctor_id: session.user.id,
        start_time: textStart,
        end_time: textEnd,
        daily_limit: noLimit ? null : limitNum,
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

  // Saves the master switch / off-days right away. Updates the doctor's
  // existing text row, or creates one with the platform defaults (8 AM-
  // 11 PM, no daily limit) if they never set one.
  async function persistTextSwitch(nextEnabled: boolean, nextDaysOff: number[]) {
    if (!supabase || !session) return;
    const prevEnabled = textEnabled;
    const prevDays = textDaysOff;
    setTextEnabled(nextEnabled);
    setTextDaysOff(nextDaysOff);
    setSavingSwitch(true);
    setTextError(null);
    const payload = { text_enabled: nextEnabled, days_off: nextDaysOff, updated_at: new Date().toISOString() };
    const { error } = textAvailability
      ? await supabase.from("doctor_text_availability").update(payload).eq("doctor_id", session.user.id)
      : await supabase.from("doctor_text_availability").insert({
          doctor_id: session.user.id,
          start_time: "08:00",
          end_time: "23:00",
          daily_limit: null,
          ...payload,
        });
    setSavingSwitch(false);
    if (error) {
      setTextEnabled(prevEnabled);
      setTextDaysOff(prevDays);
      setTextError(error.message);
      return;
    }
    load();
  }

  function toggleTextDay(day: number) {
    const next = textDaysOff.includes(day) ? textDaysOff.filter((d) => d !== day) : [...textDaysOff, day].sort();
    persistTextSwitch(textEnabled, next);
  }

  const repeatPlan = useMemo<PlanItem[]>(() => {
    if (!slots) return [];
    const thisMonday = pktMondayStart(Date.now());
    if (repeatMode === "week") {
      return planWeekRepeat(
        slots,
        thisMonday + srcWeekOffset * 7 * DAY_MS,
        thisMonday + tgtWeekOffset * 7 * DAY_MS,
        daysIncluded,
        Date.now()
      );
    }
    const src = srcDate ? parsePktDate(srcDate) : null;
    if (src === null) return [];
    const targets = tgtDates.map(parsePktDate).filter((t): t is number => t !== null);
    return planDayRepeat(slots, src, targets, Date.now());
  }, [slots, repeatMode, srcWeekOffset, tgtWeekOffset, daysIncluded, srcDate, tgtDates]);

  async function createRepeatedSlots() {
    if (!supabase || !session) return;
    const toCreate = repeatPlan.filter((p) => p.status === "new");
    if (toCreate.length === 0) return;
    if (toCreate.length > 200) {
      setRepeatError("That would create more than 200 slots at once — please choose fewer days or dates.");
      return;
    }
    setRepeating(true);
    setRepeatError(null);
    setRepeatNote(null);
    const { error } = await supabase.from("doctor_availability_slots").insert(
      toCreate.map((p) => ({
        doctor_id: session.user.id,
        start_time: new Date(p.startMs).toISOString(),
        capacity: p.capacity,
      }))
    );
    setRepeating(false);
    if (error) {
      setRepeatError(error.message);
      return;
    }
    const skipped = repeatPlan.length - toCreate.length;
    setRepeatNote(
      `Created ${toCreate.length} slot${toCreate.length === 1 ? "" : "s"}.` +
        (skipped > 0 ? ` ${skipped} skipped (already exist or in the past).` : "")
    );
    setTgtDates([]);
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
        <div className="mx-auto max-w-md rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
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
  const emptyPastCount = past.filter((s) => (bookedCounts[s.id] ?? 0) === 0).length;

  return (
    <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
        Availability
      </h1>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
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
                className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-700">Capacity</label>
              <input
                type="number"
                min={1}
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                className="mt-1 w-20 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
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

        <section className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <h2 className="text-sm font-bold text-ink-900">Text consultations</h2>
          <p className="mt-1 text-xs text-ink-500">
            Separate from the time slots — text has no scheduled meeting time, so instead set the
            daily window you&rsquo;re available to respond and a maximum number per day (Pakistan
            time). The platform is closed for text 11 PM–8 AM for every doctor regardless; leave
            the hours unset to use those standard hours with no daily limit.
          </p>

          {textError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{textError}</div>
          )}

          {textAvailability === undefined ? (
            <p className="mt-3 text-sm text-ink-400">Loading…</p>
          ) : (
            <>
              {/* Master switch + weekday chips (0062). Saved immediately. */}
              <div className="mt-4 rounded-xl border border-[#dcebe6] bg-[var(--background)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-ink-900">Accept text consultations</div>
                    <div className="text-xs text-ink-500">
                      {textEnabled
                        ? "On — patients can start new text consultations with you on the days selected below."
                        : "Off — patients can't start any new text consultations with you. Audio/video is unaffected."}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={textEnabled}
                    aria-label="Accept text consultations"
                    disabled={savingSwitch}
                    onClick={() => persistTextSwitch(!textEnabled, textDaysOff)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                      textEnabled ? "bg-teal-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        textEnabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className={`mt-3 ${textEnabled ? "" : "opacity-50"}`}>
                  <div className="text-xs font-semibold text-ink-700">Days text is ON (tap a day to turn it off)</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DAY_LABELS.map((label, i) => {
                      const day = i + 1;
                      const on = !textDaysOff.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          disabled={!textEnabled || savingSwitch}
                          aria-pressed={on}
                          onClick={() => toggleTextDay(day)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${
                            on
                              ? "border-teal-600 bg-teal-50 text-teal-800"
                              : "border-[#dcebe6] bg-white text-ink-400 line-through"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-700">From</label>
                  <input
                    type="time"
                    min="08:00"
                    max="23:00"
                    value={textStart}
                    onChange={(e) => setTextStart(e.target.value)}
                    className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
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
                    className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-700">Max per day (blank = no limit)</label>
                  <input
                    type="number"
                    min={1}
                    value={textLimit}
                    onChange={(e) => setTextLimit(e.target.value)}
                    className="mt-1 w-24 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
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
                    Reset text settings to platform default
                  </button>
                )}
              </div>
              {textAvailability ? (
                textAvailability.text_enabled ? (
                  <p className="mt-3 text-xs font-semibold text-teal-700">
                    Currently: available {toHHMM(textAvailability.start_time)}–{toHHMM(textAvailability.end_time)}
                    {textAvailability.days_off.length > 0
                      ? ` (off on ${textAvailability.days_off.map((d) => DAY_LABELS[d - 1]).join(", ")})`
                      : ", every day"}
                    ,{" "}
                    {textAvailability.daily_limit != null ? `up to ${textAvailability.daily_limit}/day.` : "no daily limit."}
                  </p>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-amber-700">
                    Currently: text consultations are switched OFF — no new text consultations can be started with you.
                  </p>
                )
              ) : (
                <p className="mt-3 text-xs text-ink-500">
                  Currently: the platform&rsquo;s standard hours apply — available 8:00 AM–11:00 PM, no daily limit.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* Repeat a schedule (2026-10-05): copy a week's (or a day's) slots to
          other dates so the doctor doesn't re-enter the same pattern. */}
      <section className="mt-7 rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <h2 className="text-sm font-bold text-ink-900">Repeat my schedule</h2>
        <p className="mt-1 text-xs text-ink-500">
          Copy slots you&rsquo;ve already added (same days, same times, same capacity) onto other
          dates instead of adding them one by one. Nothing is created until you press the button,
          and slots that already exist or are in the past are skipped.
        </p>

        <div className="mt-3 inline-flex rounded-full border border-[#dcebe6] p-0.5 text-xs font-semibold">
          {(["week", "day"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setRepeatMode(m);
                setRepeatError(null);
                setRepeatNote(null);
              }}
              className={`rounded-full px-3 py-1.5 transition ${
                repeatMode === m ? "bg-teal-600 text-white" : "text-ink-500"
              }`}
            >
              {m === "week" ? "Copy a whole week" : "Copy one day to chosen dates"}
            </button>
          ))}
        </div>

        {repeatMode === "week" ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-700">Copy from</label>
                <select
                  value={srcWeekOffset}
                  onChange={(e) => setSrcWeekOffset(parseInt(e.target.value, 10))}
                  className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                >
                  {[-1, 0, 1, 2].map((o) => (
                    <option key={o} value={o}>
                      {weekLabel(pktMondayStart(Date.now()) + o * 7 * DAY_MS, o)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-700">Into</label>
                <select
                  value={tgtWeekOffset}
                  onChange={(e) => setTgtWeekOffset(parseInt(e.target.value, 10))}
                  className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                >
                  {[0, 1, 2, 3, 4].map((o) => (
                    <option key={o} value={o}>
                      {weekLabel(pktMondayStart(Date.now()) + o * 7 * DAY_MS, o)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-ink-700">Include these days</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {DAY_LABELS.map((label, i) => {
                  const day = i + 1;
                  const on = daysIncluded.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setDaysIncluded(on ? daysIncluded.filter((d) => d !== day) : [...daysIncluded, day].sort())
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        on
                          ? "border-teal-600 bg-teal-50 text-teal-800"
                          : "border-[#dcebe6] bg-white text-ink-400 line-through"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-700">Copy the slots from this day</label>
              <input
                type="date"
                value={srcDate}
                onChange={(e) => setSrcDate(e.target.value)}
                className="mt-1 rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-700">…onto these dates</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={tgtDateDraft}
                  onChange={(e) => setTgtDateDraft(e.target.value)}
                  className="rounded-xl border border-[#dcebe6] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={!tgtDateDraft || tgtDates.includes(tgtDateDraft)}
                  onClick={() => {
                    setTgtDates([...tgtDates, tgtDateDraft].sort());
                    setTgtDateDraft("");
                  }}
                  className="rounded-full border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-800 disabled:opacity-40"
                >
                  Add date
                </button>
              </div>
              {tgtDates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {tgtDates.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800"
                    >
                      {d}
                      <button
                        type="button"
                        aria-label={`Remove ${d}`}
                        onClick={() => setTgtDates(tgtDates.filter((x) => x !== d))}
                        className="text-teal-700"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {repeatError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{repeatError}</div>
        )}
        {repeatNote && (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{repeatNote}</div>
        )}

        <div className="mt-4">
          {repeatMode === "week" && srcWeekOffset === tgtWeekOffset ? (
            <p className="text-xs text-amber-700">Choose a different week to copy into.</p>
          ) : repeatPlan.length === 0 ? (
            <p className="text-xs text-ink-400">
              {repeatMode === "day" && !srcDate
                ? "Pick the day to copy from and at least one date to copy onto."
                : "Nothing to copy yet — there are no slots on the selected source day(s)."}
            </p>
          ) : (
            <>
              <div className="text-xs font-bold uppercase tracking-wide text-ink-400">Preview</div>
              <ul className="mt-2 max-h-64 divide-y divide-ink-border overflow-auto rounded-xl border border-[#dcebe6] text-sm">
                {repeatPlan.map((p) => (
                  <li key={p.startMs} className="flex items-center justify-between px-3 py-2">
                    <span className={p.status === "new" ? "font-semibold text-ink-900" : "text-ink-400"}>
                      {fmtPkt(p.startMs)} · capacity {p.capacity}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        p.status === "new"
                          ? "bg-teal-50 text-teal-800"
                          : "bg-[var(--background)] text-ink-500"
                      }`}
                    >
                      {p.status === "new" ? "will be created" : p.status === "exists" ? "already exists" : "in the past"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={createRepeatedSlots}
                disabled={repeating || repeatPlan.every((p) => p.status !== "new")}
                className="mt-3 rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {repeating
                  ? "Creating…"
                  : `Create ${repeatPlan.filter((p) => p.status === "new").length} slot${
                      repeatPlan.filter((p) => p.status === "new").length === 1 ? "" : "s"
                    }`}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Slot lists as tables, not stacked cards (2026-09-20 — same
          density change as the consultation queue), so a doctor with
          many upcoming slots can scan them quickly. */}
      <section className="mt-7">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
          Upcoming slots
        </h2>
        {slotNote && (
          <p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">{slotNote}</p>
        )}
        {slotError && (
          <p className="mt-3 rounded-lg border border-[#dcebe6] bg-[var(--background)] px-3 py-2 text-sm text-ink-700">
            {slotError}
          </p>
        )}
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No upcoming slots yet — add one above.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#dcebe6] bg-[var(--background)] text-[11px] font-bold uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-3">Date &amp; time</th>
                  <th className="px-4 py-3 text-right">Booked</th>
                  <th className="px-4 py-3 text-right">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((s) => {
                  const booked = bookedCounts[s.id] ?? 0;
                  const full = booked >= s.capacity;
                  return (
                    <tr key={s.id} className="border-b border-[#dcebe6] last:border-b-0">
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
                      <td className="px-4 py-3 text-right text-xs">
                        {booked > 0 ? (
                          <span className="text-ink-400">Has a booking</span>
                        ) : confirmRemoveId === s.id ? (
                          <span className="inline-flex items-center gap-3">
                            <button
                              onClick={() => removeSlot(s.id)}
                              disabled={removingId === s.id}
                              className="font-semibold text-ink-900 underline underline-offset-2 disabled:opacity-50"
                            >
                              {removingId === s.id ? "Removing…" : "Yes, remove"}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              className="text-ink-500 underline underline-offset-2"
                            >
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setConfirmRemoveId(s.id);
                              setSlotNote(null);
                              setSlotError(null);
                            }}
                            className="font-semibold text-ink-500 underline underline-offset-2 hover:text-ink-900"
                          >
                            Remove
                          </button>
                        )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
              Past slots
            </h2>
            {emptyPastCount > 0 &&
              (confirmClearPast ? (
                <span className="inline-flex items-center gap-3 text-xs">
                  <button
                    onClick={clearEmptyPastSlots}
                    disabled={clearingPast}
                    className="font-semibold text-ink-900 underline underline-offset-2 disabled:opacity-50"
                  >
                    {clearingPast ? "Clearing…" : `Yes, remove ${emptyPastCount}`}
                  </button>
                  <button
                    onClick={() => setConfirmClearPast(false)}
                    className="text-ink-500 underline underline-offset-2"
                  >
                    Keep them
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setConfirmClearPast(true);
                    setSlotNote(null);
                    setSlotError(null);
                  }}
                  className="rounded-md border border-[#dcebe6] bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm hover:bg-[var(--background)]"
                >
                  Clear {emptyPastCount} empty past slot{emptyPastCount === 1 ? "" : "s"}
                </button>
              ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">Only slots nobody booked are removed. Booked ones are always kept.</p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {past.map((s) => (
                  <tr key={s.id} className="border-b border-[#dcebe6] text-ink-400 last:border-b-0">
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
