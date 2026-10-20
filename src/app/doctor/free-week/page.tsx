"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { fmtDay, fmtPktTime, pktDayKey } from "@/lib/freeWeek";

// Doctor side of the free consultation week (migration 0081).
//   * take part / withdraw (withdrawing stops NEW free bookings; visits that
//     are already booked still go ahead)
//   * set how many free consultations to give per day
//   * publish free audio times for the week (kept completely separate from
//     paid times - paid patients never see them)
// Free visits are paid nothing and are never part of earnings or payouts.

interface MyState {
  phase: "none" | "draft" | "preregister" | "open" | "ended";
  name?: string;
  starts_on?: string;
  ends_on?: string;
  modes?: string[];
  opted_in?: boolean;
  daily_free_cap?: number;
  free_visits_total?: number;
}
interface MySlot {
  id: string;
  start_time: string;
  booked: boolean;
}

function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${b}T00:00:00Z`);
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= end && out.length < 31; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const CARD = "rounded-[26px] bg-white p-5 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-6";
const BTN =
  "rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-[#b9d3cd]";

export default function DoctorFreeWeek() {
  const { profile, profileChecking, authLoading, signOut } = useDoctorProfileWithSignOut();
  const [st, setSt] = useState<MyState | null>(null);
  const [slots, setSlots] = useState<MySlot[]>([]);
  const [cap, setCap] = useState("5");
  const [agree, setAgree] = useState(false);
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("19:00");
  const [mins, setMins] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("free_week_my_state");
    if (error || !data) {
      setSt({ phase: "none" });
      return;
    }
    const s = data as MyState;
    setSt(s);
    setCap(String(s.daily_free_cap ?? 5));
    const sl = await supabase.rpc("free_week_my_slots");
    setSlots(sl.error ? [] : ((sl.data ?? []) as MySlot[]));
  }, []);

  const doctorId = profile?.id;
  useEffect(() => {
    if (!doctorId) return;
    Promise.resolve().then(load);
  }, [doctorId, load]);

  async function setOptIn(on: boolean) {
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("free_week_set_optin", {
      p_opt_in: on,
      p_daily_cap: Number(cap) || 5,
      p_accept_terms: on ? agree : false,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else {
      setMsg({ ok: true, text: on ? "You are taking part. Thank you!" : "You have withdrawn. Visits already booked will still go ahead." });
      await load();
    }
  }

  async function addSlots() {
    if (!supabase || !day) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("free_week_add_slots", {
      p_day: day,
      p_from: from,
      p_to: to,
      p_minutes: Number(mins),
    });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else {
      const r = data as { created: number; skipped: number };
      setMsg({
        ok: true,
        text: `${r.created} free time${r.created === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} skipped: already taken or in the past)` : ""}.`,
      });
      await load();
    }
  }

  async function removeSlot(id: string) {
    if (!supabase) return;
    setMsg(null);
    const { error } = await supabase.rpc("free_week_remove_slot", { p_slot_id: id });
    if (error) setMsg({ ok: false, text: error.message });
    else await load();
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="dashboard">
        <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking || !st) {
    return (
      <DoctorShell active="dashboard">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell active="dashboard" onSignOut={signOut}>
        <p className="text-sm text-ink-700">
          This page is for approved doctor accounts. <Link href="/doctor/login" className="font-semibold text-teal-700 underline">Doctor log in</Link>
        </p>
      </DoctorShell>
    );
  }

  const days = st.starts_on && st.ends_on ? datesBetween(st.starts_on, st.ends_on) : [];
  const grouped = new Map<string, MySlot[]>();
  slots.forEach((s) => grouped.set(pktDayKey(s.start_time), [...(grouped.get(pktDayKey(s.start_time)) ?? []), s]));

  return (
    <DoctorShell active="dashboard" doctorName={profile.full_name} onSignOut={signOut} doctorId={profile.id}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{st.name ?? "Free Family Consultation Week"}</h1>

      {st.phase === "none" || st.phase === "ended" ? (
        <div className={`${CARD} mt-5`}>
          <p className="text-sm text-ink-700">There is no free consultation week running right now.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className={CARD}>
            <p className="text-sm leading-relaxed text-ink-700">
              {fmtDay(st.starts_on)} to {fmtDay(st.ends_on)}. Registered families can book free <b>text</b> and <b>audio</b> consultations with
              doctors who choose to take part. You give your time; free visits are not part of earnings or payouts, and they count towards your
              normal daily patient limit.
            </p>

            {msg && (
              <p role="status" className={`mt-4 rounded-xl p-3 text-sm ${msg.ok ? "bg-teal-50 text-teal-900" : "bg-red-50 text-red-800"}`}>
                {msg.text}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-end gap-4">
              <label className="block text-sm font-semibold text-ink-700">
                Free consultations I can give per day
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  className="mt-1.5 block w-28 rounded-md border border-[#d7e7e2] px-3 py-2 text-sm"
                />
              </label>
              {st.opted_in ? (
                <>
                  <button type="button" disabled={busy} onClick={() => setOptIn(true)} className={BTN}>
                    Save daily limit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOptIn(false)}
                    className="rounded-full border border-red-300 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Withdraw
                  </button>
                </>
              ) : null}
            </div>

            {!st.opted_in && (
              <div className="mt-5">
                <label className="flex items-start gap-2.5 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700"
                  />
                  <span>
                    I volunteer my time for the free week. I understand free consultations are unpaid, I will give these patients the same standard of care
                    as paid ones, and I can withdraw at any time (already-booked visits stay).
                  </span>
                </label>
                <button type="button" disabled={busy || !agree} onClick={() => setOptIn(true)} className={`${BTN} mt-4`}>
                  Take part in the free week
                </button>
              </div>
            )}
            {st.opted_in && (
              <p className="mt-4 text-xs text-ink-500">
                {st.free_visits_total ?? 0} free consultation{(st.free_visits_total ?? 0) === 1 ? "" : "s"} booked with you so far. Text visits follow your normal text hours.
              </p>
            )}
          </div>

          {st.opted_in && (st.modes ?? []).includes("audio") && (
            <div className={CARD}>
              <h2 className="text-base font-extrabold text-ink-900">Free audio times</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                These times are only for free-week patients and are never shown to paid patients. Pakistan time. Each time lasts the number of minutes you choose.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-2 block text-xs font-semibold text-ink-700 sm:col-span-1">
                  Day
                  <select value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 block w-full rounded-md border border-[#d7e7e2] px-2 py-2 text-sm">
                    <option value="">Choose…</option>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {fmtDay(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  From
                  <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block w-full rounded-md border border-[#d7e7e2] px-2 py-2 text-sm" />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  To
                  <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block w-full rounded-md border border-[#d7e7e2] px-2 py-2 text-sm" />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  Minutes each
                  <select value={mins} onChange={(e) => setMins(e.target.value)} className="mt-1 block w-full rounded-md border border-[#d7e7e2] px-2 py-2 text-sm">
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                  </select>
                </label>
              </div>
              <button type="button" disabled={busy || !day} onClick={addSlots} className={`${BTN} mt-4`}>
                Add free times
              </button>

              {slots.length > 0 && (
                <div className="mt-5 space-y-3">
                  {Array.from(grouped.entries()).map(([k, list]) => (
                    <div key={k}>
                      <p className="text-xs font-extrabold uppercase tracking-wide text-teal-700">{fmtDay(k)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {list.map((s) => (
                          <span
                            key={s.id}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                              s.booked ? "bg-teal-700 text-white" : "bg-[#eef6f3] text-teal-900"
                            }`}
                          >
                            {fmtPktTime(s.start_time)}
                            {s.booked ? (
                              <span className="font-medium opacity-80">booked</span>
                            ) : (
                              <button type="button" aria-label="Remove this time" onClick={() => removeSlot(s.id)} className="text-ink-500 hover:text-red-600">
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </DoctorShell>
  );
}
