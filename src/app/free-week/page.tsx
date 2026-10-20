"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import FormField from "@/components/FormField";
import { RatingBadge, useDoctorRatings } from "@/components/DoctorRating";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { COMPLAINTS } from "@/lib/complaints";
import { normalizePhone } from "@/lib/phone";
import { RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";
import { fmtDay, fmtPkt, fmtPktDay, fmtPktTime, pktDayKey, useFreeWeekStatus, type FreeWeekStatus } from "@/lib/freeWeek";

// Free consultation week (2026-10-20). One page, and nothing else on the
// site depends on it:
//   not signed in -> create an account / log in
//   signed in     -> register the family (mobile number, one account per number)
//   registered    -> before the week: see the doctors taking part
//                    during the week: pick a doctor, text or audio, reason,
//                    who it is for -> booked (no payment).
// Every rule (3 per family, one claim per mobile, doctor limits, the dates and
// the on/off switch) is enforced in the database (migration 0081); this page
// only explains them and shows friendly messages.

interface FreeDoctor {
  doctor_id: string;
  daily_free_cap: number;
  free_left_today: number;
  open_slots: number;
}
interface DirDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  profile_photo_url?: string | null;
}
interface FreeSlot {
  id: string;
  doctor_id: string;
  start_time: string;
}
interface TextStatus {
  configured: boolean;
  is_open: boolean;
  remaining: number | null;
  start_time: string | null;
  end_time: string | null;
}

const CARD = "rounded-[26px] bg-white p-5 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-6";
const BTN =
  "rounded-full bg-teal-700 px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(15,118,110,0.3)] transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-[#b9d3cd] disabled:shadow-none";
const RED_COMPLAINTS = new Set(["Shortness of breath", "Chest pain"]);

function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w && !/^dr\.?$/i.test(w));
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "Dr";
}

function formatHHMM(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Avatar({ d, size = 48 }: { d: DirDoctor; size?: number }) {
  if (d.profile_photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={d.profile_photo_url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-2xl object-cover" />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-300 to-teal-700 text-base font-extrabold text-[#0a3733]"
    >
      {initials(d.full_name)}
    </div>
  );
}

// ------------------------------------------------------------ registration

function Register({ status, onDone }: { status: FreeWeekStatus; onDone: () => void }) {
  const [phone, setPhone] = useState(status.phone_on_file ?? "");
  const [agree, setAgree] = useState(false);
  const [offers, setOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ phone?: string; agree?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fe: typeof fieldErr = {};
    if (!normalizePhone(phone)) fe.phone = "Please enter a valid mobile number, for example 0300 1234567.";
    if (!agree) fe.agree = "Please tick to confirm you have read the free week terms.";
    setFieldErr(fe);
    setErr(null);
    if (Object.keys(fe).length > 0 || !supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc("free_week_enrol", { p_phone: phone.trim(), p_marketing_consent: offers });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate className={`${CARD} space-y-5`}>
      <div>
        <h2 className="text-lg font-extrabold text-ink-900">Register your family for the free week</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          One registration per family. Your mobile number is kept private &mdash; doctors never see it.
        </p>
      </div>
      {err && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
          {err}
        </div>
      )}
      <FormField
        label="Mobile number"
        name="fwPhone"
        type="tel"
        value={phone}
        onChange={setPhone}
        error={fieldErr.phone}
        placeholder="0300 1234567"
        autoComplete="tel"
        required
        hint="Each mobile number can register one family."
      />
      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700 focus:ring-teal-500"
          />
          <span>
            I have read the{" "}
            <Link href="/free-week/terms" className="font-semibold text-teal-700 underline underline-offset-2">
              free week terms
            </Link>
            .
          </span>
        </label>
        {fieldErr.agree && <p className="mt-1 text-xs font-medium text-red-600">{fieldErr.agree}</p>}
      </div>
      <label className="flex items-start gap-2.5 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={offers}
          onChange={(e) => setOffers(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700 focus:ring-teal-500"
        />
        <span>
          Optional: it is OK to message me about Family Medic offers and news. (Messages about your visits are always
          sent.)
        </span>
      </label>
      <button type="submit" disabled={busy} className={`${BTN} w-full`}>
        {busy ? "Registering…" : "Register for the free week"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------ doctor list

function useParticipants(enabled: boolean) {
  const [free, setFree] = useState<FreeDoctor[] | null>(null);
  const [dir, setDir] = useState<DirDoctor[]>([]);
  useEffect(() => {
    if (!supabase || !enabled) return;
    const client = supabase;
    let cancelled = false;
    (async () => {
      const { data, error } = await client.rpc("free_week_doctors_list");
      if (cancelled) return;
      if (error) {
        setFree([]);
        return;
      }
      const rows = (data ?? []) as FreeDoctor[];
      setFree(rows);
      if (rows.length === 0) return;
      let res: { data: unknown; error: { message: string } | null } = await client
        .from("public_doctor_directory")
        .select("id, full_name, specialty, consultation_fee, profile_photo_url")
        .in("id", rows.map((r) => r.doctor_id));
      if (res.error) {
        res = await client
          .from("public_doctor_directory")
          .select("id, full_name, specialty, consultation_fee")
          .in("id", rows.map((r) => r.doctor_id));
      }
      if (!cancelled && !res.error) setDir(res.data as DirDoctor[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { free, dir };
}

// ------------------------------------------------------------ booking

function Booking({ status, onBooked }: { status: FreeWeekStatus; onBooked: () => void }) {
  const ratings = useDoctorRatings();
  const { free, dir } = useParticipants(true);
  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [complaint, setComplaint] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [textStatus, setTextStatus] = useState<{ doctorId: string; t: TextStatus | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ mode: "text" | "audio"; when: string | null; doctor: string } | null>(null);

  const modes = status.modes ?? ["text", "audio"];

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    (async () => {
      let res = await client.from("family_members").select("*").is("archived_at", null).order("created_at", { ascending: true });
      if (res.error) res = await client.from("family_members").select("*").order("created_at", { ascending: true });
      if (!cancelled && !res.error) setMembers(res.data as FamilyMember[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Free audio times (only loaded once, shared by every doctor).
  useEffect(() => {
    if (!supabase || !modes.includes("audio")) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("free_week_open_slots")).then(({ data, error }) => {
      if (!cancelled) setSlots(error ? [] : ((data ?? []) as FreeSlot[]));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supabase || !pickedId) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("text_availability_status", { p_doctor_id: pickedId })).then(({ data, error }) => {
      if (cancelled) return;
      const t = !error && data && data.length > 0 ? (data[0] as TextStatus) : null;
      setTextStatus({ doctorId: pickedId, t });
    });
    return () => {
      cancelled = true;
    };
  }, [pickedId]);

  const doctors = useMemo(
    () =>
      (free ?? [])
        .map((f) => ({ f, d: dir.find((x) => x.id === f.doctor_id) }))
        .filter((x): x is { f: FreeDoctor; d: DirDoctor } => !!x.d)
        .sort((a, b) => a.d.full_name.localeCompare(b.d.full_name)),
    [free, dir]
  );
  const picked = doctors.find((x) => x.f.doctor_id === pickedId) ?? null;
  const tStatus = textStatus && textStatus.doctorId === pickedId ? textStatus.t : null;
  const textClosed = !!tStatus && tStatus.configured && !tStatus.is_open;

  const doctorSlots = useMemo(() => (slots ?? []).filter((s) => s.doctor_id === pickedId), [slots, pickedId]);
  const slotDays = useMemo(() => {
    const m = new Map<string, FreeSlot[]>();
    doctorSlots.forEach((s) => {
      const k = pktDayKey(s.start_time);
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return Array.from(m.entries());
  }, [doctorSlots]);
  const activeDay = dayPick && slotDays.some(([k]) => k === dayPick) ? dayPick : slotDays[0]?.[0] ?? null;

  const member =
    members?.find((m) => m.id === memberId) ?? members?.find((m) => m.relationship === "self") ?? members?.[0] ?? null;
  const canBook =
    !!picked &&
    !!complaint &&
    !!member &&
    (mode === "text" ? !textClosed : !!slotId) &&
    picked.f.free_left_today > 0 &&
    (status.credits_left ?? 0) > 0;

  async function book() {
    if (!supabase || !picked || !complaint || !member) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("free_week_claim", {
      p_patient_id: member.id,
      p_doctor_id: picked.f.doctor_id,
      p_complaint: complaint,
      p_delivery_mode: mode,
      p_slot_id: mode === "audio" ? slotId : null,
    });
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Something went wrong. Please try again.");
      if (mode === "audio") {
        setSlotId(null);
        void Promise.resolve(supabase.rpc("free_week_open_slots")).then(({ data: d }) => setSlots((d ?? []) as FreeSlot[]));
      }
      return;
    }
    const chosen = doctorSlots.find((s) => s.id === slotId);
    setDone({ mode, when: mode === "audio" && chosen ? fmtPkt(chosen.start_time) : null, doctor: picked.d.full_name });
    onBooked();
  }

  if (done) {
    return (
      <div className={`${CARD} text-center`}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-2xl text-teal-700" aria-hidden="true">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-extrabold text-ink-900">Your free consultation is booked</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {done.mode === "audio"
            ? `Audio call with ${done.doctor} on ${done.when} (Pakistan time). You can join from your dashboard shortly before the time.`
            : `Text consultation with ${done.doctor}. Open your dashboard to message the doctor; they will reply there.`}
        </p>
        <div className="mt-5 flex flex-col items-center gap-3">
          <Link href="/dashboard" className={BTN}>
            Go to my dashboard
          </Link>
          {(status.credits_left ?? 0) > 1 && (
            <button type="button" onClick={() => window.location.reload()} className="text-sm font-semibold text-teal-700 underline underline-offset-2">
              Book another free consultation
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={`${CARD} flex items-center justify-between gap-3`}>
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal-700">Your free consultations</p>
          <p className="mt-0.5 text-2xl font-extrabold text-ink-900">
            {status.credits_left ?? 0} <span className="text-sm font-bold text-ink-500">of {status.credits_per_account ?? 3} left</span>
          </p>
        </div>
        <p className="max-w-[12rem] text-right text-xs leading-snug text-ink-500">Shared by everyone in your family account.</p>
      </div>

      {(status.credits_left ?? 0) <= 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You have used all your free consultations. Thank you for trying Family Medic!{" "}
          <Link href="/book" className="font-bold underline underline-offset-2">
            Book a regular consultation
          </Link>
          .
        </div>
      )}

      {err && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {err}
        </div>
      )}

      <div className={CARD}>
        <h2 className="text-base font-extrabold text-ink-900">1. Choose a doctor</h2>
        {free === null ? (
          <p className="mt-3 text-sm text-ink-500">Loading doctors…</p>
        ) : doctors.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No doctor is taking free consultations right now. Please check again soon.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {doctors.map(({ f, d }) => {
              const full = f.free_left_today <= 0;
              const on = pickedId === f.doctor_id;
              return (
                <li key={f.doctor_id}>
                  <button
                    type="button"
                    disabled={full}
                    onClick={() => {
                      setPickedId(f.doctor_id);
                      setSlotId(null);
                      setErr(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                      on ? "border-teal-600 bg-teal-50" : "border-transparent bg-[#f5faf8] hover:border-teal-300"
                    }`}
                  >
                    <Avatar d={d} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[15px] font-extrabold text-ink-900">{d.full_name}</span>
                      <span className="block text-xs text-ink-500">{d.specialty ?? "Family physician"}</span>
                      <span className="mt-1 block">
                        <RatingBadge summary={ratings[f.doctor_id]} size={12} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] font-bold text-ink-400 line-through">
                        {d.consultation_fee != null ? `PKR ${d.consultation_fee}` : ""}
                      </span>
                      <span className="block rounded-full bg-[#fff0d6] px-2.5 py-1 text-[11px] font-extrabold text-amber-800">
                        {full ? "Full today" : "FREE"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {picked && (
        <>
          <div className={CARD}>
            <h2 className="text-base font-extrabold text-ink-900">2. How would you like to talk?</h2>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {modes.includes("text") && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("text");
                    setSlotId(null);
                  }}
                  className={`rounded-2xl border-2 p-3.5 text-left transition ${mode === "text" ? "border-teal-600 bg-teal-50" : "border-transparent bg-[#f5faf8]"}`}
                >
                  <span className="block text-sm font-extrabold text-ink-900">Text</span>
                  <span className="block text-xs text-ink-500">Chat at your own pace</span>
                </button>
              )}
              {modes.includes("audio") && (
                <button
                  type="button"
                  onClick={() => setMode("audio")}
                  className={`rounded-2xl border-2 p-3.5 text-left transition ${mode === "audio" ? "border-teal-600 bg-teal-50" : "border-transparent bg-[#f5faf8]"}`}
                >
                  <span className="block text-sm font-extrabold text-ink-900">Audio call</span>
                  <span className="block text-xs text-ink-500">A short phone-style call</span>
                </button>
              )}
            </div>
            {mode === "text" && textClosed && tStatus?.start_time && tStatus.end_time && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                This doctor answers text consultations between {formatHHMM(tStatus.start_time)} and {formatHHMM(tStatus.end_time)}. Please try
                then, or pick an audio time.
              </p>
            )}
            {mode === "audio" && (
              <div className="mt-4">
                {slots === null ? (
                  <p className="text-sm text-ink-500">Loading free times…</p>
                ) : slotDays.length === 0 ? (
                  <p className="text-sm text-ink-500">
                    This doctor has no free audio times left. Try text, or another doctor.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {slotDays.map(([k, list]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setDayPick(k);
                            setSlotId(null);
                          }}
                          className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-extrabold ${
                            activeDay === k ? "bg-teal-700 text-white" : "bg-[#eef6f3] text-teal-800"
                          }`}
                        >
                          {fmtPktDay(list[0].start_time)}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(slotDays.find(([k]) => k === activeDay)?.[1] ?? []).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSlotId(s.id)}
                          className={`rounded-xl px-3.5 py-2 text-sm font-bold ${
                            slotId === s.id ? "bg-teal-700 text-white" : "bg-[#eef6f3] text-teal-900 hover:bg-teal-100"
                          }`}
                        >
                          {fmtPktTime(s.start_time)}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-ink-500">Times are Pakistan time.</p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className={CARD}>
            <h2 className="text-base font-extrabold text-ink-900">3. What is it about?</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPLAINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setComplaint(c)}
                  className={`rounded-full px-3.5 py-2 text-sm font-bold transition ${
                    complaint === c ? "bg-teal-700 text-white" : "bg-[#eef6f3] text-teal-900 hover:bg-teal-100"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {complaint && RED_COMPLAINTS.has(complaint) && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800">
                Chest pain or difficulty breathing can be an emergency. If it is severe or sudden, please go to the nearest hospital
                or call 1122 now instead of waiting for an online consultation.
              </p>
            )}
          </div>

          <div className={CARD}>
            <h2 className="text-base font-extrabold text-ink-900">4. Who is it for?</h2>
            {members === null ? (
              <p className="mt-3 text-sm text-ink-500">Loading…</p>
            ) : (
              <select
                value={member?.id ?? ""}
                onChange={(e) => setMemberId(e.target.value)}
                className="mt-3 block w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-3 text-sm text-ink-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({RELATIONSHIP_LABEL[m.relationship] ?? m.relationship})
                  </option>
                ))}
              </select>
            )}
            <p className="mt-2 text-xs text-ink-500">
              Need to add a family member?{" "}
              <Link href="/dashboard" className="font-semibold text-teal-700 underline underline-offset-2">
                Open your dashboard
              </Link>
              .
            </p>
          </div>

          <button type="button" onClick={book} disabled={!canBook || busy} className={`${BTN} w-full py-4 text-base`}>
            {busy ? "Booking…" : "Book my FREE consultation"}
          </button>
          <p className="text-center text-xs leading-relaxed text-ink-500">
            No payment needed. Free consultations are for non-emergency care and follow the same clinical standards as paid ones.
          </p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ preregister list

function Participants() {
  const ratings = useDoctorRatings();
  const { free, dir } = useParticipants(true);
  const rows = (free ?? []).map((f) => dir.find((d) => d.id === f.doctor_id)).filter((d): d is DirDoctor => !!d);
  return (
    <div className={CARD}>
      <h2 className="text-base font-extrabold text-ink-900">Doctors joining the free week</h2>
      {free === null ? (
        <p className="mt-3 text-sm text-ink-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">We are confirming the doctors now &mdash; check back soon.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-[#f5faf8] p-3">
              <Avatar d={d} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-extrabold text-ink-900">{d.full_name}</span>
                <span className="block text-xs text-ink-500">{d.specialty ?? "Family physician"}</span>
              </span>
              <RatingBadge summary={ratings[d.id]} size={12} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------ page

export default function FreeWeekPage() {
  const { session, loading } = useAuth();
  const { status, reload } = useFreeWeekStatus(session?.user.id ?? null);

  const signedIn = !!session;

  const next = encodeURIComponent("/free-week");

  if (loading || status === null) {
    return (
      <div>
        <PageHeader title="Free Family Consultation Week" />
        <div className="mx-auto max-w-lg px-4 py-10 text-sm text-ink-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  const phase = status.phase;
  const title = status.name || "Free Family Consultation Week";

  if (phase === "none") {
    return (
      <div>
        <PageHeader title="Free Family Consultation Week" subtitle="This offer is not running right now." />
        <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
          <div className={CARD}>
            <p className="text-sm leading-relaxed text-ink-700">
              There is no free consultation week at the moment. You can still book a consultation with one of our verified doctors.
            </p>
            <Link href="/book" className={`${BTN} mt-5 inline-block`}>
              Book a consultation
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const intro =
    phase === "open"
      ? `Free until ${fmtDay(status.ends_on)}: up to ${status.credits_per_account ?? 3} free text or audio consultations per family.`
      : phase === "preregister"
        ? `Starts ${fmtDay(status.starts_on)}. Register your family now so you are ready on the day.`
        : "Thank you to every family and doctor who took part.";

  return (
    <div>
      <PageHeader title={title} subtitle={intro} />
      <div className="mx-auto max-w-lg space-y-5 px-4 py-8 sm:px-6">
        <div className={CARD}>
          <ul className="space-y-2.5 text-sm text-ink-700">
            <li>✔ Up to {status.credits_per_account ?? 3} free consultations per family account</li>
            <li>✔ Text chat or audio call with verified doctors who volunteered their time</li>
            <li>✔ Dates: {fmtDay(status.starts_on)} to {fmtDay(status.ends_on)}</li>
            <li>✔ No payment, no card needed</li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            For non-emergency care.{" "}
            <Link href="/free-week/terms" className="font-semibold text-teal-700 underline underline-offset-2">
              Read the terms
            </Link>
            .
          </p>
        </div>

        {phase === "ended" ? (
          <div className={CARD}>
            <p className="text-sm leading-relaxed text-ink-700">
              The free week has finished. Your doctors and prescriptions remain in your dashboard, and you can book any time.
            </p>
            <Link href="/book" className={`${BTN} mt-4 inline-block`}>
              Book a consultation
            </Link>
          </div>
        ) : !signedIn ? (
          <div className={`${CARD} space-y-3`}>
            <h2 className="text-lg font-extrabold text-ink-900">Create your free account</h2>
            <p className="text-sm leading-relaxed text-ink-500">
              You need a registered account (email + mobile number) to claim free consultations. It takes a minute.
            </p>
            <Link href={`/register?next=${next}`} className={`${BTN} block text-center`}>
              Create a free account
            </Link>
            <Link href={`/login?next=${next}`} className="block text-center text-sm font-semibold text-teal-700 underline underline-offset-2">
              I already have an account &mdash; log in
            </Link>
          </div>
        ) : status.is_guest ? (
          <div className={CARD}>
            <p className="text-sm leading-relaxed text-ink-700">
              Free consultations are for registered accounts. Please create a free account with your email, then come back to this page.
            </p>
            <Link href={`/register?next=${next}`} className={`${BTN} mt-4 inline-block`}>
              Create a free account
            </Link>
          </div>
        ) : !status.enrolled ? (
          <Register status={status} onDone={reload} />
        ) : phase === "preregister" ? (
          <>
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
              <p className="font-extrabold">You are registered.</p>
              <p className="mt-0.5">Free consultations open on {fmtDay(status.starts_on)}. Come back to this page then to book.</p>
            </div>
            <Participants />
          </>
        ) : (
          <Booking status={status} onBooked={reload} />
        )}
      </div>
    </div>
  );
}
