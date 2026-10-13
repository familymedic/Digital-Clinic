"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Phase 8, step 2: the doctor's side of self-service slot booking for
// audio/video consultations (Section 35).
//
// 2026-10-13: weekly planner. The doctor ticks the weekdays they work,
// sets up to two time windows (start time + number of slots) and picks
// 3, 4 or 5 minutes per slot. The database cuts the windows into slots
// for the next 7 days in one all-or-nothing step (apply_weekly_plan,
// migration 0073). "Add a time slot" is kept for one-off extra slots, and
// extending the schedule by another week lives on the dashboard.

interface SlotRow {
  id: string;
  start_time: string;
  capacity: number;
  source: string; // 'manual' | 'plan'
  booked: number; // bookings currently holding the slot (paid, or unpaid within 30 min)
  has_bookings: boolean; // any booking at all, whatever its status
}

interface SavedPlan {
  days: number[];
  slot_minutes: number;
  windows: { start: string; count: number }[];
  covered_until: string; // YYYY-MM-DD
}

interface WindowDraft {
  start: string; // "HH:MM"
  count: string; // text so the doctor can clear the box while typing
}

interface TextAvailabilityRow {
  start_time: string; // "HH:MM:SS"
  end_time: string;
  daily_limit: number | null; // null = no daily limit
  text_enabled: boolean; // master switch (0062)
  days_off: number[]; // ISO weekdays text is OFF on: 1 = Mon ... 7 = Sun (0062)
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---- Pakistan-time helpers --------------------------------------------
// Pakistan has no daylight saving, so a "day" is always 24 hours there.
// Every day/time decision on this page is made in Pakistan time (UTC+5),
// whatever timezone the doctor's browser is set to — the same time zone
// the database uses when it cuts the plan into slots.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 100; // planner limit, both windows together (matches the database)
const SLOT_LIST_DAYS = 14; // how far ahead the slot list shows
const SLOT_LIST_LIMIT = 1500; // matches list_my_slots

function pktDayKey(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}
function pktDayLabel(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+05:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}
function fmtSlotTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
}
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? h * 60 + mm : null;
}
function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmtClock(total: number): string {
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}
function fmtDateShort(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+05:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function isMissingFunction(message: string | undefined): boolean {
  return !!message && /could not find the function|does not exist|schema cache/i.test(message);
}

interface PlanCheck {
  error: string | null; // first thing wrong, in plain words (null = fine)
  perDay: number;
  windows: { start: string; count: number }[];
  ends: (number | null)[]; // end minute of each window (null if it can't be worked out)
}

// Mirrors validate_slot_plan in the database (which is the real gatekeeper).
function checkPlan(days: number[], minutes: number, drafts: WindowDraft[]): PlanCheck {
  const windows: { start: string; count: number }[] = [];
  const ends: (number | null)[] = [];
  let error: string | null = null;
  let perDay = 0;
  let prevEnd = -1;
  drafts.forEach((d, i) => {
    const label = drafts.length > 1 ? `Window ${i + 1}: ` : "";
    const startMin = toMinutes(d.start);
    const count = /^\d{1,4}$/.test(d.count.trim()) ? parseInt(d.count, 10) : NaN;
    if (startMin === null) {
      ends.push(null);
      error = error ?? `${label}please choose a start time.`;
      return;
    }
    if (!Number.isFinite(count) || count < 1 || count > MAX_PER_DAY) {
      ends.push(null);
      error = error ?? `${label}enter between 1 and ${MAX_PER_DAY} slots.`;
      return;
    }
    const end = startMin + count * minutes;
    ends.push(end);
    if (end > 1440) {
      error = error ?? `${label}this runs past midnight. Start earlier or use fewer slots.`;
    } else if (startMin < prevEnd) {
      error = error ?? `${label}it overlaps the window above. Start it after ${fmtClock(prevEnd)}.`;
    }
    prevEnd = end;
    perDay += count;
    windows.push({ start: d.start, count });
  });
  if (!error && days.length === 0) error = "Tick at least one day of the week.";
  if (!error && perDay > MAX_PER_DAY) {
    error = `That is ${perDay} slots in a day. The most is ${MAX_PER_DAY} per day (both windows together).`;
  }
  return { error, perDay, windows, ends };
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
  const [loadError, setLoadError] = useState<string | null>(null);

  // Removing empty slots. Two-step confirm, inline.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [slotNote, setSlotNote] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  // Which day groups are expanded in the slot list (null = just the first day).
  const [openDays, setOpenDays] = useState<string[] | null>(null);

  const [newDate, setNewDate] = useState("");
  const [newCapacity, setNewCapacity] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Weekly planner (2026-10-13).
  const [savedPlan, setSavedPlan] = useState<SavedPlan | null>(null);
  const [planDays, setPlanDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [planMinutes, setPlanMinutes] = useState<number>(4);
  const [win1, setWin1] = useState<WindowDraft>({ start: "14:00", count: "15" });
  const [win2, setWin2] = useState<WindowDraft | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [endHint, setEndHint] = useState<string | null>(null);
  // Fill the planner boxes from the saved plan once, not on every reload
  // (a reload after removing a slot must not wipe what the doctor is typing).
  const plannerPrefilled = useRef(false);

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

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoadError(null);

    // Only the window the page shows (yesterday to 14 days ahead) is fetched,
    // so a doctor with thousands of slots never slows this page down.
    const nowMs = Date.now();
    const fromIso = new Date(nowMs - DAY_MS).toISOString();
    const toIso = new Date(nowMs + SLOT_LIST_DAYS * DAY_MS).toISOString();

    const [slotsRes, textRes, planRes] = await Promise.all([
      supabase.rpc("list_my_slots", { p_from: fromIso, p_to: toIso }),
      supabase
        .from("doctor_text_availability")
        .select("start_time, end_time, daily_limit, text_enabled, days_off")
        .eq("doctor_id", session.user.id)
        .maybeSingle(),
      supabase
        .from("doctor_slot_plans")
        .select("days, slot_minutes, windows, covered_until")
        .eq("doctor_id", session.user.id)
        .maybeSingle(),
    ]);

    let rows: SlotRow[];
    if (!slotsRes.error) {
      rows = (slotsRes.data ?? []) as SlotRow[];
    } else if (isMissingFunction(slotsRes.error.message)) {
      // The planner's database update (0073) isn't installed yet: keep the
      // page working the old way so a doctor is never locked out.
      const [oldSlots, oldBookings] = await Promise.all([
        supabase
          .from("doctor_availability_slots")
          .select("id, start_time, capacity")
          .eq("doctor_id", session.user.id)
          .gte("start_time", fromIso)
          .lt("start_time", toIso)
          .order("start_time", { ascending: true })
          .limit(SLOT_LIST_LIMIT),
        supabase.from("consultations").select("slot_id").not("slot_id", "is", null),
      ]);
      if (oldSlots.error) {
        setLoadError(oldSlots.error.message);
        return;
      }
      const counts: Record<string, number> = {};
      for (const row of (oldBookings.data ?? []) as { slot_id: string }[]) {
        counts[row.slot_id] = (counts[row.slot_id] ?? 0) + 1;
      }
      rows = (oldSlots.data as { id: string; start_time: string; capacity: number }[]).map((s) => ({
        ...s,
        source: "manual",
        booked: counts[s.id] ?? 0,
        has_bookings: (counts[s.id] ?? 0) > 0,
      }));
    } else {
      setLoadError(slotsRes.error.message);
      return;
    }
    setSlots(rows);

    if (!planRes.error) {
      const p = planRes.data as SavedPlan | null;
      setSavedPlan(p);
      if (p && !plannerPrefilled.current && Array.isArray(p.windows) && p.windows.length > 0) {
        plannerPrefilled.current = true;
        setPlanDays(p.days);
        setPlanMinutes(p.slot_minutes);
        setWin1({ start: p.windows[0].start, count: String(p.windows[0].count) });
        setWin2(p.windows[1] ? { start: p.windows[1].start, count: String(p.windows[1].count) } : null);
      }
    }

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

  // Housekeeping: past slots nobody booked are deleted automatically (older
  // than a day). Quiet and optional — if it fails or isn't installed yet,
  // nothing visible changes.
  useEffect(() => {
    if (!supabase || !session) return;
    Promise.resolve(supabase.rpc("cleanup_my_past_slots")).then(
      () => undefined,
      () => undefined
    );
  }, [session]);

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

  async function addSlot() {
    if (!supabase || !session || !newDate) return;
    setCreateError(null);
    setSlotNote(null);
    setSlotError(null);

    // The date box has no time zone, so it is read as Pakistan time — the same
    // clock the planner and the patients' booking page use.
    const when = new Date(`${newDate.length === 16 ? `${newDate}:00` : newDate}+05:00`);
    if (Number.isNaN(when.getTime())) {
      setCreateError("Please choose a valid date and time.");
      return;
    }
    if (when.getTime() <= Date.now()) {
      setCreateError("Please choose a time in the future.");
      return;
    }

    setCreating(true);
    const capacityNum = parseInt(newCapacity, 10);
    const { error: insertError } = await supabase.from("doctor_availability_slots").insert({
      doctor_id: session.user.id,
      start_time: when.toISOString(),
      capacity: Number.isFinite(capacityNum) && capacityNum > 0 ? capacityNum : 1,
    });

    setCreating(false);
    if (insertError) {
      setCreateError(insertError.message);
      return;
    }
    setNewDate("");
    setNewCapacity("1");
    setSlotNote("Slot added.");
    const dayKey = pktDayKey(when.getTime());
    setOpenDays((cur) => (cur && cur.includes(dayKey) ? cur : [...(cur ?? []), dayKey]));
    load();
  }

  function toggleDay(day: number) {
    setPlanDays((cur) => (cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort((a, b) => a - b)));
    setPlanNote(null);
    setPlanError(null);
  }

  // The end time is worked out from the start time and the number of slots
  // (raising the slots pushes the end later). If the doctor types an end time
  // instead, the number of slots that fit is filled in and the end snaps to
  // the last whole slot.
  function setWindowEnd(which: 1 | 2, value: string) {
    const w = which === 1 ? win1 : win2;
    if (!w) return;
    const startMin = toMinutes(w.start);
    const endMin = toMinutes(value);
    if (startMin === null || endMin === null) return;
    const fit = Math.floor((endMin - startMin) / planMinutes);
    if (fit < 1) {
      setEndHint("The end time must be at least one slot after the start time.");
      return;
    }
    setEndHint(
      fit > MAX_PER_DAY ? `At ${planMinutes} minutes a slot, ${MAX_PER_DAY} slots is the most for one window.` : null
    );
    const next = { ...w, count: String(Math.min(fit, MAX_PER_DAY)) };
    if (which === 1) setWin1(next);
    else setWin2(next);
    setPlanNote(null);
    setPlanError(null);
  }

  async function savePlan() {
    if (!supabase || !session || planSaving) return;
    const check = checkPlan(planDays, planMinutes, win2 ? [win1, win2] : [win1]);
    if (check.error) {
      setPlanError(check.error);
      return;
    }
    setPlanSaving(true);
    setPlanError(null);
    setPlanNote(null);
    const days = [...planDays].sort((a, b) => a - b);
    const { data, error } = await supabase.rpc("apply_weekly_plan", {
      p_days: days,
      p_minutes: planMinutes,
      p_windows: check.windows,
    });
    setPlanSaving(false);
    if (error) {
      setPlanError(
        isMissingFunction(error.message)
          ? "The weekly planner isn't switched on for this site yet. Nothing was changed."
          : error.message
      );
      return;
    }
    const r = (data ?? {}) as { created?: number; removed?: number; kept_with_bookings?: number; covered_until?: string };
    const created = r.created ?? 0;
    const removed = r.removed ?? 0;
    const kept = r.kept_with_bookings ?? 0;
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} new slot${created === 1 ? "" : "s"} added`);
    if (removed > 0) parts.push(`${removed} unbooked slot${removed === 1 ? "" : "s"} from the old plan removed`);
    if (kept > 0) parts.push(`${kept} slot${kept === 1 ? "" : "s"} with bookings kept as they were`);
    const until = r.covered_until ? ` Your schedule now runs until ${fmtDateShort(r.covered_until)}.` : "";
    setPlanNote(
      (parts.length > 0 ? `Saved: ${parts.join(", ")}.` : "Saved. Your slots already match this plan.") + until
    );
    plannerPrefilled.current = true;
    if (r.covered_until) {
      setSavedPlan({ days, slot_minutes: planMinutes, windows: check.windows, covered_until: r.covered_until });
    }
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

  if (slots === null) {
    return (
      <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  const now = Date.now();
  const dayGroups: { key: string; slots: SlotRow[] }[] = [];
  for (const s of slots) {
    if (new Date(s.start_time).getTime() < now) continue;
    const key = pktDayKey(new Date(s.start_time).getTime());
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.key === key) last.slots.push(s);
    else dayGroups.push({ key, slots: [s] });
  }
  const pastBooked = slots.filter((s) => new Date(s.start_time).getTime() < now && s.has_bookings);
  const planCheck = checkPlan(planDays, planMinutes, win2 ? [win1, win2] : [win1]);

  return (
    <DoctorShell active="availability" doctorName={profile.full_name} onSignOut={signOut}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
        Availability
      </h1>

      {/* Weekly planner (2026-10-13): days + up to two time windows + minutes
          per slot. The database turns it into slots for the next 7 days in
          one all-or-nothing step. */}
      <section className="mt-7 rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
        <h2 className="text-sm font-bold text-ink-900">Weekly plan</h2>
        <p className="mt-1 text-xs text-ink-500">
          Tick the days you work, set your hours, and choose how long each slot is. Slots are created
          for the next 7 days (Pakistan time). Saving again later updates the unbooked slots from your
          plan; slots that already have a booking, and slots you add by hand, are never changed.
        </p>
        <p className="mt-2 text-xs font-semibold text-ink-700" data-testid="plan-status">
          {savedPlan
            ? savedPlan.covered_until >= pktDayKey(Date.now())
              ? `Your schedule currently runs until ${fmtDateShort(savedPlan.covered_until)}. In its last 2 days you can extend it by another week from your dashboard.`
              : "Your last schedule has ended. Save your plan again, or extend it from your dashboard."
            : "You haven't saved a weekly plan yet."}
        </p>

        <div className="mt-4">
          <p className="text-xs font-semibold text-ink-700">Days you work</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DAY_LABELS.map((label, i) => {
              const day = i + 1;
              const on = planDays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(day)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    on
                      ? "border-teal-600 bg-teal-600 text-white"
                      : "border-[#dcebe6] bg-white text-ink-700 hover:bg-[var(--background)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-ink-700">Minutes per slot</p>
          <div className="mt-2 inline-flex rounded-full border border-[#dcebe6] p-0.5 text-sm font-semibold">
            {[3, 4, 5].map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={planMinutes === m}
                onClick={() => {
                  setPlanMinutes(m);
                  setEndHint(null);
                  setPlanNote(null);
                  setPlanError(null);
                }}
                className={`rounded-full px-4 py-1.5 transition ${
                  planMinutes === m ? "bg-teal-600 text-white" : "text-ink-700 hover:bg-[var(--background)]"
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {([1, 2] as const).map((which) => {
            const w = which === 1 ? win1 : win2;
            if (!w) return null;
            const setW = which === 1 ? setWin1 : setWin2;
            const info = planCheck.ends[which - 1];
            const countNum = /^\d{1,4}$/.test(w.count.trim()) ? parseInt(w.count, 10) : null;
            const startMin = toMinutes(w.start);
            const endValue = info !== null && info !== undefined && info < 1440 ? minutesToHHMM(info) : "";
            return (
              <div key={which} className="rounded-2xl border border-[#dcebe6] bg-[var(--background)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink-900">{which === 1 ? "Time window" : "Second time window"}</p>
                  {which === 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        setWin2(null);
                        setEndHint(null);
                        setPlanNote(null);
                        setPlanError(null);
                      }}
                      className="text-xs font-semibold text-ink-500 underline underline-offset-2 hover:text-ink-900"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-ink-700" htmlFor={`w${which}-start`}>
                      From
                    </label>
                    <input
                      id={`w${which}-start`}
                      aria-label={`Window ${which} start time`}
                      type="time"
                      value={w.start}
                      onChange={(e) => {
                        setW({ ...w, start: e.target.value });
                        setEndHint(null);
                        setPlanNote(null);
                        setPlanError(null);
                      }}
                      className="mt-1 rounded-xl border border-[#dcebe6] bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-700" htmlFor={`w${which}-count`}>
                      Slots
                    </label>
                    <input
                      id={`w${which}-count`}
                      aria-label={`Window ${which} number of slots`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_PER_DAY}
                      value={w.count}
                      onChange={(e) => {
                        setW({ ...w, count: e.target.value });
                        setEndHint(null);
                        setPlanNote(null);
                        setPlanError(null);
                      }}
                      className="mt-1 w-20 rounded-xl border border-[#dcebe6] bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-700" htmlFor={`w${which}-end`}>
                      Until
                    </label>
                    <input
                      id={`w${which}-end`}
                      aria-label={`Window ${which} end time`}
                      type="time"
                      value={endValue}
                      onChange={(e) => setWindowEnd(which, e.target.value)}
                      className="mt-1 rounded-xl border border-[#dcebe6] bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-700" data-testid={`w${which}-summary`}>
                  {startMin !== null && countNum !== null && countNum >= 1 && info !== null && info !== undefined
                    ? info <= 1440
                      ? `${countNum} slot${countNum === 1 ? "" : "s"} · ${fmtClock(startMin)} – ${fmtClock(info % 1440)}`
                      : "This runs past midnight."
                    : "Enter a start time and the number of slots."}
                </p>
              </div>
            );
          })}
        </div>

        {!win2 && (
          <button
            type="button"
            onClick={() => {
              const prevEnd = planCheck.ends[0];
              const start = prevEnd !== null && prevEnd !== undefined && prevEnd < 1380 ? minutesToHHMM(prevEnd + 60 > 1439 ? prevEnd : prevEnd + 60) : "18:00";
              setWin2({ start, count: "10" });
              setPlanNote(null);
              setPlanError(null);
            }}
            className="mt-3 text-sm font-semibold text-teal-700 underline underline-offset-2"
          >
            + Add a second time window
          </button>
        )}

        {endHint && <p className="mt-3 text-xs text-amber-800">{endHint}</p>}

        <div className="mt-4 rounded-xl border border-[#dcebe6] bg-white p-3 text-xs text-ink-700" data-testid="plan-summary">
          {planCheck.error ? (
            <span className="font-semibold text-red-700">{planCheck.error}</span>
          ) : (
            <>
              <span className="font-semibold text-ink-900">
                {planCheck.perDay} slot{planCheck.perDay === 1 ? "" : "s"} a day
              </span>{" "}
              (limit {MAX_PER_DAY}), {planDays.length} day{planDays.length === 1 ? "" : "s"} a week —{" "}
              {planCheck.perDay * planDays.length} slots a week.
            </>
          )}
        </div>

        {planError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {planError}
          </div>
        )}
        {planNote && (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900" role="status">
            {planNote}
          </div>
        )}

        <button
          type="button"
          onClick={savePlan}
          disabled={planSaving || !!planCheck.error}
          className="mt-4 rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {planSaving ? "Saving…" : savedPlan ? "Save plan & update slots" : "Save plan & create slots"}
        </button>
      </section>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-[#dcebe6] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <h2 className="text-sm font-bold text-ink-900">Add one extra slot</h2>
          <p className="mt-1 text-xs text-ink-500">
            For a one-off time outside your weekly plan — for example to fit in a patient on a busy
            day. Shared for both audio and video consultations. Set a capacity above 1 if you&rsquo;re
            happy to take more than one patient at that time.
          </p>

          {createError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-700">Date &amp; time (Pakistan time)</label>
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

      {/* Upcoming slots, one collapsible group per day so a busy doctor
          (up to 100 slots a day) can still scan the week quickly. */}
      <section className="mt-7">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
          Upcoming slots · next {SLOT_LIST_DAYS} days (Pakistan time)
        </h2>
        {slotNote && (
          <p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">{slotNote}</p>
        )}
        {slotError && (
          <p className="mt-3 rounded-lg border border-[#dcebe6] bg-[var(--background)] px-3 py-2 text-sm text-ink-700">
            {slotError}
          </p>
        )}
        {slots.length >= SLOT_LIST_LIMIT && (
          <p className="mt-3 text-xs text-ink-500">
            Showing the first {SLOT_LIST_LIMIT.toLocaleString()} slots of the next {SLOT_LIST_DAYS} days.
          </p>
        )}
        {dayGroups.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No upcoming slots yet — save a weekly plan above.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {dayGroups.map((g, idx) => {
              const isOpen = (openDays ?? [dayGroups[0].key]).includes(g.key);
              const bookedInDay = g.slots.reduce((n, s) => n + s.booked, 0);
              return (
                <div key={g.key} className="overflow-hidden rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenDays((cur) => {
                        const base = cur ?? [dayGroups[0].key];
                        return base.includes(g.key) ? base.filter((k) => k !== g.key) : [...base, g.key];
                      })
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
                    data-testid={`day-${idx}`}
                  >
                    <span className="text-sm font-bold text-ink-900">{pktDayLabel(g.key)}</span>
                    <span className="text-xs text-ink-500">
                      {g.slots.length} slot{g.slots.length === 1 ? "" : "s"} · {fmtSlotTime(g.slots[0].start_time)} –{" "}
                      {fmtSlotTime(g.slots[g.slots.length - 1].start_time)}
                      {bookedInDay > 0 ? ` · ${bookedInDay} booked` : ""} {isOpen ? "▴" : "▾"}
                    </span>
                  </button>
                  {isOpen && (
                    <table className="w-full border-collapse border-t border-[#dcebe6] text-left text-sm">
                      <tbody>
                        {g.slots.map((s) => {
                          const full = s.booked >= s.capacity;
                          return (
                            <tr key={s.id} className="border-b border-[#dcebe6] last:border-b-0">
                              <td className="px-4 py-2.5 font-semibold text-ink-900">
                                {fmtSlotTime(s.start_time)}
                                {s.source === "manual" && (
                                  <span className="ml-2 rounded-full bg-[var(--background)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                                    added by hand
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    full ? "bg-[var(--background)] text-ink-500" : "bg-teal-50 text-teal-800"
                                  }`}
                                >
                                  {s.booked} / {s.capacity}
                                  {full ? " · full" : ""}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs">
                                {s.has_bookings ? (
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {pastBooked.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
            Recent slots with bookings
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Past slots nobody booked are cleaned up automatically after a day.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#dcebe6] bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {pastBooked.map((s) => (
                  <tr key={s.id} className="border-b border-[#dcebe6] text-ink-400 last:border-b-0">
                    <td className="px-4 py-3">
                      {new Date(s.start_time).toLocaleString("en-GB", {
                        timeZone: "Asia/Karachi",
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">{s.booked} / {s.capacity} booked</td>
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
