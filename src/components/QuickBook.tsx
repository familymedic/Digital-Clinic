"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { COMPLAINTS } from "@/lib/complaints";
import { normalizePhone } from "@/lib/phone";

// Quick booking for people who are not logged in (the old logged-out screen
// of /book - "Please log in or create an account first" - is replaced by this
// ONLY while NEXT_PUBLIC_QUICK_BOOKING=true). The order follows how a patient
// thinks, and matches the large Pakistani booking sites:
//
//   doctor -> how & when -> reason -> name & mobile -> payment
//
// Doctors, times and prices are all public information, so they are shown
// BEFORE asking for anything personal. A real account is created silently at
// the last step (just before payment) - exactly the same kind of account, and
// the same consultation insert and payment call, that a logged-in patient's
// booking uses. After payment the patient gets a saved link and can choose a
// PIN (see GuestAccessPanel). Logged-in patients never see this component.

interface DirectoryDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
}

type DeliveryMode = "text" | "audio" | "video";

const MODES: { value: DeliveryMode; label: string; description: string }[] = [
  { value: "text", label: "Text", description: "Chat with the doctor at your own pace" },
  { value: "audio", label: "Audio call", description: "A phone-style call at a time you pick" },
  { value: "video", label: "Video call", description: "A face-to-face visit at a time you pick" },
];

interface OpenSlot {
  id: string;
  doctor_id: string;
  start_time: string;
  capacity: number;
  remaining: number;
}

interface TextStatus {
  configured: boolean;
  is_open: boolean;
  remaining: number | null;
  start_time: string | null;
  end_time: string | null;
}

interface CapacityStatus {
  daily_cap: number;
  today_count: number;
  remaining: number;
  is_full: boolean;
}

type Step = "doctor" | "when" | "reason" | "details";

function formatHHMM(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const AVATAR_TONES = [
  "from-teal-300 to-teal-700",
  "from-emerald-300 to-emerald-700",
  "from-cyan-300 to-teal-600",
  "from-amber-300 to-amber-600",
  "from-sky-300 to-sky-700",
];

function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w && !/^dr\.?$/i.test(w));
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "Dr";
}

// A small icon for each bookable reason. Purely decorative (aria-hidden); the
// reason's name is what the patient picks and what is saved.
const COMPLAINT_ICONS: Record<string, string> = {
  Fever: "🌡️",
  Cough: "😮‍💨",
  "Sore throat": "🗣️",
  "Abdominal pain": "🤢",
  "Diarrhea / vomiting": "💧",
  Headache: "🤕",
  "Back pain": "🦴",
  "Urinary symptoms": "🚻",
  "Shortness of breath": "🫁",
  "Chest pain": "❤️",
};
const RED_COMPLAINTS = new Set(["Shortness of breath", "Chest pain"]);

const STEP_LABELS = ["Doctor", "When", "Reason", "Details"];
const STEP_ORDER: Step[] = ["doctor", "when", "reason", "details"];

const CARD = "rounded-[26px] bg-white shadow-[0_10px_30px_rgba(10,55,51,0.07)]";

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function Avatar({ name, tone, size = 58 }: { name: string; tone: number; size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-[19px] bg-gradient-to-br ${AVATAR_TONES[tone % AVATAR_TONES.length]} text-lg font-extrabold text-[#0a3733]`}
    >
      {initials(name)}
    </div>
  );
}

// Dark-teal header band (same as every inner page) with a four-step progress
// bar, and a body that overlaps the band's lower edge.
function Shell({
  step,
  subtitle,
  onBack,
  backLabel,
  children,
}: {
  step: Step;
  subtitle: string;
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
}) {
  const idx = STEP_ORDER.indexOf(step);
  return (
    <div>
      <div className="rounded-b-[32px] bg-[radial-gradient(800px_320px_at_88%_-30%,rgba(45,212,191,0.28),transparent_60%),linear-gradient(180deg,#0a3733,#072927)]">
        <div className="mx-auto max-w-lg px-4 pb-16 pt-7 sm:px-6">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mb-4 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-teal-50 ring-1 ring-white/20 transition hover:bg-white/20"
            >
              {backLabel ?? "← Back"}
            </button>
          )}
          <span className="mb-3.5 block h-1.5 w-10 rounded-full bg-[#ffb454]" aria-hidden="true" />
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-[30px]">Book a consultation</h1>
          <p className="mt-2 text-sm leading-relaxed text-teal-100/85">{subtitle}</p>
          <div className="mt-4 flex gap-1.5" aria-hidden="true">
            {STEP_ORDER.map((st, i) => (
              <span
                key={st}
                className={`h-[5px] flex-1 rounded-full ${i < idx ? "bg-teal-300" : i === idx ? "bg-[#ffb454]" : "bg-white/20"}`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] font-bold tracking-wide text-teal-100/70" aria-hidden="true">
            {STEP_LABELS.map((l, i) => (
              <span key={l} className={i === idx ? "text-white" : ""}>
                {l}
              </span>
            ))}
          </div>
          <p className="sr-only">
            Step {idx + 1} of 4: {STEP_LABELS[idx]}
          </p>
        </div>
      </div>
      <div className="mx-auto -mt-10 max-w-lg px-4 pb-10 sm:px-6">{children}</div>
    </div>
  );
}

// Continue button in a bar that stays in reach at the bottom of the phone
// screen while the step is on screen, with a live summary beside it.
function ActionBar({
  top,
  main,
  label,
  disabled,
  onClick,
}: {
  top: string;
  main: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="sticky bottom-3 z-10 mt-6 flex items-center gap-3 rounded-[26px] border border-[#e3ece9] bg-white/95 p-3 pl-5 shadow-[0_14px_36px_-12px_rgba(7,41,39,0.35)] backdrop-blur">
      <div className="min-w-0 text-[11px] font-bold leading-tight text-ink-500">
        <span className="block truncate">{top}</span>
        <span className="block truncate text-[15px] font-extrabold text-ink-900">{main}</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="ml-auto shrink-0 rounded-full bg-teal-700 px-5 py-3 sm:px-7 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(15,118,110,0.35)] transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-[#b9d3cd] disabled:shadow-none"
      >
        {label}
      </button>
    </div>
  );
}

function ModeIcon({ mode }: { mode: DeliveryMode }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinejoin: "round" as const };
  if (mode === "text")
    return (
      <svg {...common} aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      </svg>
    );
  if (mode === "audio")
    return (
      <svg {...common} aria-hidden="true">
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
      </svg>
    );
  return (
    <svg {...common} aria-hidden="true">
      <rect x="3" y="6" width="12" height="12" rx="3" />
      <path d="m15 10 6-3v10l-6-3" />
    </svg>
  );
}

export default function QuickBook({
  doctorId,
  onBusy,
}: {
  doctorId: string | null;
  // Tells /book to keep showing this screen once the silent account exists
  // (otherwise the page would flip to the logged-in booking screens mid-way).
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();

  const [doctors, setDoctors] = useState<DirectoryDoctor[] | null>(null);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);
  const [pickedDoctor, setPickedDoctor] = useState<DirectoryDoctor | null>(null);
  const [step, setStep] = useState<Step>("doctor");

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("text");
  const [slotsState, setSlotsState] = useState<
    { status: "idle" | "loading" | "ready" | "error"; slots: OpenSlot[]; message?: string }
  >({ status: "idle", slots: [] });
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const [complaint, setComplaint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneOk, setPhoneOk] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "phone" | "phoneOk" | "terms", string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFor, setStatusFor] = useState<{
    doctorId: string;
    text: TextStatus | null;
    cap: CapacityStatus | null;
  } | null>(null);

  // The doctor list is public (same view the Our Doctors page uses).
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("public_doctor_directory")
      .select("id, full_name, specialty, consultation_fee")
      .order("full_name", { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setDoctorsError(err.message);
        else setDoctors(data as DirectoryDoctor[]);
      });
  }, []);

  // Arrived from a doctor's "Book now" button: that doctor is the choice.
  const fromLink = useMemo(
    () => (doctorId && doctors ? doctors.find((d) => d.id === doctorId) ?? null : null),
    [doctorId, doctors]
  );
  const selectedDoctor = pickedDoctor ?? fromLink;
  const currentStep: Step = selectedDoctor ? (step === "doctor" ? "when" : step) : "doctor";

  const selectedDoctorId = selectedDoctor?.id ?? null;
  useEffect(() => {
    if (!supabase || !selectedDoctorId) return;
    let cancelled = false;
    Promise.all([
      supabase.rpc("text_availability_status", { p_doctor_id: selectedDoctorId }),
      supabase.rpc("doctor_daily_capacity", { p_doctor_id: selectedDoctorId }),
    ]).then(([t, c]) => {
      if (cancelled) return;
      const text = !t.error && t.data && t.data.length > 0 ? (t.data[0] as TextStatus) : null;
      const cap = !c.error && c.data && c.data.length > 0 ? (c.data[0] as CapacityStatus) : null;
      setStatusFor({ doctorId: selectedDoctorId, text, cap });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDoctorId]);
  const status = statusFor && statusFor.doctorId === selectedDoctorId ? statusFor : null;
  const textStatus = status?.text ?? null;
  const capacityStatus = status?.cap ?? null;

  const specialties = useMemo(() => {
    if (!doctors) return [];
    return Array.from(new Set(doctors.map((d) => d.specialty ?? "Other"))).sort();
  }, [doctors]);

  const doctorSlots = useMemo(
    () => slotsState.slots.filter((s) => s.doctor_id === selectedDoctorId),
    [slotsState.slots, selectedDoctorId]
  );

  // Open times grouped by calendar day (a day strip, then that day's times).
  const slotDays = useMemo(() => {
    const m = new Map<string, OpenSlot[]>();
    [...doctorSlots]
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .forEach((sl) => {
        const k = dayKey(sl.start_time);
        m.set(k, [...(m.get(k) ?? []), sl]);
      });
    return Array.from(m.entries());
  }, [doctorSlots]);

  async function loadSlots() {
    if (!supabase) return;
    setSlotsState({ status: "loading", slots: [] });
    const { data, error: rpcError } = await supabase.rpc("list_open_slots");
    if (rpcError) {
      setSlotsState({
        status: "error",
        slots: [],
        message: "We couldn't load the available times. Please try again, or choose a text consultation.",
      });
    } else {
      setSlotsState({ status: "ready", slots: (data ?? []) as OpenSlot[] });
    }
  }

  function chooseMode(mode: DeliveryMode) {
    setDeliveryMode(mode);
    setSelectedSlotId(null);
    setError(null);
    if (mode !== "text") void loadSlots();
  }

  const selectedSlot = doctorSlots.find((s) => s.id === selectedSlotId) ?? null;
  const textClosed = deliveryMode === "text" && textStatus != null && !textStatus.is_open;
  const dayFull = capacityStatus != null && capacityStatus.is_full;
  const whenReady =
    !dayFull && !textClosed && (deliveryMode === "text" || (!!selectedSlotId && !!selectedSlot));

  const phoneParsed = normalizePhone(phone);

  async function submit() {
    if (!supabase || !selectedDoctor || !complaint) return;
    const errs: typeof fieldErrors = {};
    if (fullName.trim().length < 2) errs.name = "Please enter the patient's full name.";
    if (!phoneParsed) errs.phone = "Please enter a valid mobile number, for example 0300 1234567.";
    else if (!phoneOk) errs.phoneOk = "Please confirm the mobile number is correct.";
    if (!agreeTerms) errs.terms = "Please agree to the Terms and Privacy Policy to continue.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const client = supabase;
    setSubmitting(true);
    setError(null);

    let {
      data: { session: s },
    } = await client.auth.getSession();

    // 1. The silent account (skipped on a retry - it already exists then).
    if (!s) {
      onBusy(true);
      const created = await apiFetch<{ email?: string; password?: string; error?: string }>("/api/guest/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim(), agreedTerms: agreeTerms }),
      });
      if (!created.ok || !created.data?.email || !created.data?.password) {
        onBusy(false);
        setError(created.error ?? created.data?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      const { error: signInError } = await client.auth.signInWithPassword({
        email: created.data.email,
        password: created.data.password,
      });
      if (signInError) {
        onBusy(false);
        setError("Your booking was started, but we couldn't continue automatically. Please try again.");
        setSubmitting(false);
        return;
      }
      s = (await client.auth.getSession()).data.session;
    }
    if (!s) {
      onBusy(false);
      setError("We couldn't continue. Please try again.");
      setSubmitting(false);
      return;
    }

    // 2. The patient is the account holder's own ("self") record.
    const { data: members } = await client
      .from("family_members")
      .select("id")
      .eq("relationship", "self")
      .order("created_at", { ascending: true })
      .limit(1);
    const selfId = (members as { id: string }[] | null)?.[0]?.id;
    if (!selfId) {
      setError("We couldn't find your patient record. Please try again.");
      setSubmitting(false);
      return;
    }

    // 3. The booking - the same insert the normal booking page makes.
    const { data: booked, error: insertError } = await client
      .from("consultations")
      .insert({
        patient_id: selfId,
        doctor_id: selectedDoctor.id,
        complaint,
        delivery_mode: deliveryMode,
        ...(deliveryMode !== "text" ? { slot_id: selectedSlotId } : {}),
      })
      .select("id")
      .single();

    if (insertError || !booked) {
      setSubmitting(false);
      setError(insertError?.message ?? "Something went wrong — please try again.");
      if (deliveryMode !== "text") {
        // The time may have just been taken - show the real list again.
        setSelectedSlotId(null);
        setStep("when");
        void loadSlots();
      }
      return;
    }

    // 4. Payment - the same call the normal booking page makes. If it fails
    //    the booking is not lost: the payment page offers a retry.
    try {
      const res = await fetch(`/api/consultations/${booked.id}/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
    } catch {
      /* fall through to the payment page */
    }
    setSubmitting(false);
    router.push(`/consultation/${booked.id}/payment`);
  }


  // ------------------------------------------------------------------ views

  const modeLabel = MODES.find((m) => m.value === deliveryMode)?.label ?? "";
  const slotText = selectedSlot
    ? new Date(selectedSlot.start_time).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const feeText = selectedDoctor?.consultation_fee != null ? `PKR ${selectedDoctor.consultation_fee}` : "";
  const doctorTone = selectedDoctor && doctors ? Math.max(0, doctors.findIndex((d) => d.id === selectedDoctor.id)) : 0;

  const errorBox = error && (
    <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Couldn&rsquo;t book that: {error}
    </div>
  );

  // Compact reminder of what has been chosen so far (reason + details steps).
  const summary = selectedDoctor && (
    <div className={`${CARD} mb-5 flex items-center gap-3 p-3.5 shadow-[0_18px_40px_rgba(10,55,51,0.14)]`}>
      <Avatar name={selectedDoctor.full_name} tone={doctorTone} size={44} />
      <div className="min-w-0 text-sm">
        <p className="break-words font-extrabold leading-tight text-ink-900">
          {selectedDoctor.full_name}
          {feeText && <span className="font-bold text-teal-800"> &middot; {feeText}</span>}
        </p>
        <p className="text-xs font-medium text-ink-500">
          {modeLabel}
          {slotText && ` · ${slotText}`}
          {currentStep === "details" && complaint ? ` · ${complaint}` : ""}
        </p>
      </div>
    </div>
  );

  const accountCard = (withCreate: boolean) => (
    <div className={`${CARD} mt-5 flex items-start gap-3 p-4 text-xs leading-relaxed text-ink-700`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff6e5] text-amber-700" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
        </svg>
      </span>
      <div>
        <p>
          <span className="font-extrabold text-ink-900">Do you have an account?</span>{" "}
          <Link href="/login" className="font-bold text-teal-700 underline underline-offset-2">
            Log in
          </Link>
          {withCreate && (
            <>
              {" "}
              or{" "}
              <Link href="/register" className="font-bold text-teal-700 underline underline-offset-2">
                create an account
              </Link>{" "}
              to keep all your visits in one place.
            </>
          )}
        </p>
        <p className="mt-1 text-ink-500">
          <span className="font-bold text-ink-700">No account needed</span> &mdash; carry on below to book as a guest.
          {withCreate && " We’ll give you a link to your appointment after you pay."}
        </p>
      </div>
    </div>
  );

  if (currentStep === "doctor") {
    const q = query.trim().toLowerCase();
    const shown = (doctors ?? []).filter(
      (d) => !q || d.full_name.toLowerCase().includes(q) || (d.specialty ?? "other").toLowerCase().includes(q)
    );
    const shownSpecialties = specialties.filter((spec) => shown.some((d) => (d.specialty ?? "Other") === spec));
    return (
      <Shell step="doctor" subtitle="Which doctor would you like to see?">
        {doctorsError && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load doctors: {doctorsError}
          </div>
        )}
        {!doctorsError && doctors && doctors.length > 0 && (
          <div className="flex items-center gap-2.5 rounded-full bg-white px-4 py-3 shadow-[0_12px_28px_rgba(10,55,51,0.14)] focus-within:ring-2 focus-within:ring-teal-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="shrink-0 text-ink-500" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search doctor or specialty"
              placeholder="Search doctor or specialty"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500"
            />
          </div>
        )}
        {!doctorsError && doctors === null && <p className={`${CARD} p-5 text-sm text-ink-500`}>Loading doctors…</p>}
        {!doctorsError && doctors && doctors.length === 0 && (
          <div className="rounded-3xl border border-dashed border-[#d7e7e2] bg-white p-6 text-center text-sm text-ink-500">
            No doctors are available to book right now. Please check back soon.
          </div>
        )}
        {!doctorsError && doctors && doctors.length > 0 && shown.length === 0 && (
          <div className="mt-4 rounded-3xl border border-dashed border-[#d7e7e2] bg-white p-6 text-center text-sm text-ink-500">
            No doctor matches &ldquo;{query.trim()}&rdquo;.
          </div>
        )}
        {shown.length > 0 &&
          shownSpecialties.map((spec) => (
            <div key={spec}>
              <p className="mb-2 mt-5 px-1 text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-ink-500">{spec}</p>
              {shown
                .filter((d) => (d.specialty ?? "Other") === spec)
                .map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setPickedDoctor(d);
                      setStep("when");
                    }}
                    className={`${CARD} mb-2.5 flex w-full items-center gap-3.5 border-2 border-transparent p-3.5 text-left transition hover:border-teal-300`}
                  >
                    <Avatar name={d.full_name} tone={Math.max(0, (doctors ?? []).findIndex((x) => x.id === d.id))} size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[15px] font-extrabold leading-tight text-ink-900">{d.full_name}</span>
                      <span className="block truncate text-xs text-ink-500">{d.specialty ?? "Other"}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block whitespace-nowrap rounded-full bg-teal-50 px-3 py-1.5 text-xs font-extrabold text-teal-800">
                        PKR {d.consultation_fee}
                      </span>
                      <span className="mt-1 block text-[10.5px] font-extrabold text-teal-700">Book ›</span>
                    </span>
                  </button>
                ))}
            </div>
          ))}
        <div className={`${CARD} mt-5 flex items-center gap-3 p-4 text-xs leading-relaxed text-ink-700`}>
          <p>
            <span className="font-extrabold text-ink-900">No account needed</span> &mdash; book as a guest in a minute.
            Already have an account?{" "}
            <Link href="/login" className="font-bold text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </div>
      </Shell>
    );
  }

  if (currentStep === "when") {
    const activeDay =
      (pickedDay && slotDays.some(([k]) => k === pickedDay) ? pickedDay : null) ??
      (selectedSlot ? dayKey(selectedSlot.start_time) : null) ??
      slotDays[0]?.[0] ??
      null;
    const daySlots = slotDays.find(([k]) => k === activeDay)?.[1] ?? [];
    return (
      <Shell
        step="when"
        subtitle="How and when would you like to see the doctor?"
        onBack={
          fromLink
            ? undefined
            : () => {
                setPickedDoctor(null);
                setStep("doctor");
              }
        }
        backLabel="← Choose a different doctor"
      >
        {selectedDoctor && (
          <div className={`${CARD} flex items-center gap-3.5 p-4 shadow-[0_18px_40px_rgba(10,55,51,0.14)]`}>
            <Avatar name={selectedDoctor.full_name} tone={doctorTone} />
            <div className="min-w-0">
              <p className="break-words text-base font-extrabold leading-tight text-ink-900">{selectedDoctor.full_name}</p>
              <span className="mt-1 inline-block rounded-full bg-teal-50 px-2.5 py-1 text-[11.5px] font-extrabold text-teal-800">
                {selectedDoctor.specialty ?? "Doctor"}
              </span>
            </div>
            {feeText && (
              <div className="ml-auto shrink-0 whitespace-nowrap text-right">
                <span className="block text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Fee</span>
                <span className="text-[17px] font-extrabold text-teal-800">{feeText}</span>
              </div>
            )}
          </div>
        )}

        <h2 className="mb-2.5 mt-6 px-1 text-[13px] font-extrabold text-ink-900">How would you like to consult?</h2>
        {errorBox}
        {dayFull && capacityStatus && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {selectedDoctor?.full_name} has reached their maximum of {capacityStatus.daily_cap} patients for today.
            Please try again tomorrow or choose a different doctor.
          </div>
        )}
        <div className="grid grid-cols-3 gap-2.5">
          {MODES.map((opt) => {
            const on = deliveryMode === opt.value;
            return (
              <label
                key={opt.value}
                className={`relative flex cursor-pointer flex-col items-center rounded-[22px] border-2 px-2 pb-3 pt-3.5 text-center shadow-[0_10px_26px_rgba(10,55,51,0.07)] transition focus-within:ring-2 focus-within:ring-teal-600 ${
                  on ? "border-teal-600 bg-gradient-to-b from-white to-teal-50" : "border-transparent bg-white hover:border-teal-300"
                }`}
              >
                <input
                  type="radio"
                  name="delivery_mode"
                  className="sr-only"
                  checked={on}
                  onChange={() => chooseMode(opt.value)}
                />
                {on && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-white" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  </span>
                )}
                <span
                  className={`mb-2 flex h-[42px] w-[42px] items-center justify-center rounded-[14px] ${on ? "bg-teal-700 text-white" : "bg-teal-50 text-teal-700"}`}
                >
                  <ModeIcon mode={opt.value} />
                </span>
                <span className="text-[13.5px] font-extrabold text-ink-900">{opt.label}</span>
                <span className="mt-0.5 text-[11px] leading-snug text-ink-500">{opt.description}</span>
              </label>
            );
          })}
        </div>

        {deliveryMode === "text" && textStatus && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[12.5px] font-bold ${
              textStatus.is_open ? "bg-[#e7f8f2] text-teal-800" : "bg-amber-50 text-amber-800"
            }`}
          >
            {textStatus.is_open && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.2)]" aria-hidden="true" />}
            <span>
              {textStatus.is_open
                ? `Open now${textStatus.remaining != null ? ` — ${textStatus.remaining} left today` : ""}`
                : textStatus.remaining === 0
                  ? "Fully booked for text today — try again tomorrow, or choose audio/video."
                  : textStatus.start_time && textStatus.end_time
                    ? `Closed right now — available ${formatHHMM(textStatus.start_time)}–${formatHHMM(textStatus.end_time)} (Pakistan time).`
                    : "Not available for text right now."}
            </span>
          </div>
        )}

        {deliveryMode !== "text" && (
          <div>
            <h2 className="mb-2.5 mt-6 px-1 text-[13px] font-extrabold text-ink-900">Pick an available time</h2>
            {slotsState.status === "loading" && <p className="px-1 text-sm text-ink-500">Loading available times…</p>}
            {slotsState.status === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {slotsState.message}
                <button onClick={() => void loadSlots()} className="ml-2 font-bold underline underline-offset-2">
                  Try again
                </button>
              </div>
            )}
            {slotsState.status === "ready" && slotDays.length === 0 && (
              <div className="rounded-3xl border border-dashed border-[#d7e7e2] bg-white p-6 text-center text-sm text-ink-500">
                No open times right now for {selectedDoctor?.full_name}. Please check back soon, or choose a text
                consultation.
              </div>
            )}
            {slotsState.status === "ready" && slotDays.length > 0 && (
              <>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5" role="group" aria-label="Day">
                  {slotDays.map(([k, list]) => {
                    const d = new Date(list[0].start_time);
                    const on = k === activeDay;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPickedDay(k)}
                        aria-pressed={on}
                        aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                        className={`w-[62px] shrink-0 rounded-[18px] border-2 py-2.5 text-center shadow-[0_8px_20px_rgba(10,55,51,0.06)] transition ${
                          on ? "border-[#0a3733] bg-[#0a3733] text-white" : "border-transparent bg-white text-ink-900 hover:border-teal-300"
                        }`}
                      >
                        <span className={`block text-[10.5px] font-bold uppercase tracking-wider ${on ? "text-teal-200" : "text-ink-500"}`}>
                          {d.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className="block text-[19px] font-extrabold leading-tight">{d.getDate()}</span>
                        <span className={`block text-[10px] font-bold ${on ? "text-teal-200" : "text-ink-500"}`}>
                          {d.toLocaleDateString(undefined, { month: "short" })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2.5">
                  {daySlots.map((slot) => {
                    const on = selectedSlotId === slot.id;
                    const full = slot.remaining <= 0;
                    return (
                      <label
                        key={slot.id}
                        className={`rounded-2xl border-2 py-2.5 text-center text-[13px] font-extrabold transition focus-within:ring-2 focus-within:ring-teal-600 ${
                          full
                            ? "cursor-not-allowed border-[#d6e5e1] bg-white opacity-40"
                            : on
                              ? "cursor-pointer border-teal-700 bg-teal-700 text-white"
                              : "cursor-pointer border-[#d6e5e1] bg-white text-ink-900 hover:border-teal-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="slot"
                          className="sr-only"
                          disabled={full}
                          checked={on}
                          onChange={() => setSelectedSlotId(slot.id)}
                        />
                        {new Date(slot.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        <span className={`mt-0.5 block text-[10px] font-bold ${on ? "text-teal-100" : "text-ink-500"}`}>
                          {full ? "Full" : `${slot.remaining} spot${slot.remaining === 1 ? "" : "s"} left`}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {accountCard(true)}

        <ActionBar
          top={deliveryMode === "text" ? "Text consultation" : slotText ? `${modeLabel} · ${slotText.split(",").slice(0, 2).join(",")}` : modeLabel}
          main={
            deliveryMode === "text"
              ? feeText
              : selectedSlot
                ? `${new Date(selectedSlot.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${feeText ? ` · ${feeText}` : ""}`
                : "Pick a time"
          }
          label="Continue"
          disabled={!whenReady}
          onClick={() => {
            setError(null);
            setStep("reason");
          }}
        />
      </Shell>
    );
  }

  if (currentStep === "reason") {
    return (
      <Shell step="reason" subtitle="What is the main reason for the visit?" onBack={() => setStep("when")}>
        {summary}
        <p className="mb-4 flex gap-2.5 rounded-2xl bg-[#fff7e6] px-4 py-3 text-xs leading-relaxed text-[#7c4a03]">
          <span aria-hidden="true">⚠️</span>
          <span>
            <span className="font-extrabold">Not for emergencies.</span> If you or your family member has severe chest pain,
            trouble breathing, heavy bleeding, fainting, or any sudden severe symptom, go to the nearest emergency room or
            contact your local emergency service now &mdash; don&rsquo;t wait for an online consultation.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {COMPLAINTS.map((c) => {
            const on = complaint === c;
            return (
              <button
                key={c}
                onClick={() => setComplaint(c)}
                aria-pressed={on}
                className={`flex items-center gap-2.5 rounded-[18px] border-2 p-3 text-left text-[13px] font-bold shadow-[0_8px_20px_rgba(10,55,51,0.06)] transition ${
                  on ? "border-teal-600 bg-gradient-to-b from-white to-teal-50 text-teal-800" : "border-transparent bg-white text-ink-900 hover:border-teal-300"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-base ${
                    on ? "bg-teal-700" : RED_COMPLAINTS.has(c) ? "bg-red-100" : "bg-teal-50"
                  }`}
                >
                  {COMPLAINT_ICONS[c] ?? "＋"}
                </span>
                {c}
              </button>
            );
          })}
        </div>
        {(complaint === "Chest pain" || complaint === "Shortness of breath") && (
          <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
            <p className="font-semibold">This can be an emergency.</p>
            <p className="mt-1">
              If the {complaint.toLowerCase()} is severe, sudden, or getting worse, go to the nearest emergency room now
              instead of booking an online consultation. Only continue if it is mild and you are safe to wait.
            </p>
          </div>
        )}
        <ActionBar
          top={slotText ? `${modeLabel} · ${slotText.split(",").slice(0, 2).join(",")}` : modeLabel}
          main={complaint ?? "Choose a reason"}
          label="Continue"
          disabled={!complaint}
          onClick={() => setStep("details")}
        />
      </Shell>
    );
  }

  // details
  return (
    <Shell
      step="details"
      subtitle="Last step: who is the patient? Then you pay securely to confirm."
      onBack={submitting ? undefined : () => setStep("reason")}
    >
      {summary}
      {error && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
        className="space-y-5 rounded-[26px] bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]"
      >
        <FormField
          label="Patient's full name"
          name="qbName"
          value={fullName}
          onChange={setFullName}
          error={fieldErrors.name}
          autoComplete="name"
          required
        />
        <div>
          <FormField
            label="Mobile number"
            name="qbPhone"
            type="tel"
            value={phone}
            onChange={(v) => {
              setPhone(v);
              setPhoneOk(false);
            }}
            error={fieldErrors.phone}
            placeholder="0300 1234567"
            autoComplete="tel"
            hint="Your doctor will see this number. You'll also use it to find your appointment later."
            required
          />
          {phoneParsed && (
            <label className="mt-3 flex items-start gap-2.5 rounded-2xl bg-[#f1f8f5] p-3 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={phoneOk}
                onChange={(e) => setPhoneOk(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700 focus:ring-teal-500"
              />
              <span>
                Yes, <span className="font-semibold">{phoneParsed.display}</span> is correct.
              </span>
            </label>
          )}
          {fieldErrors.phoneOk && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.phoneOk}</p>}
        </div>
        <div>
          <label className="flex items-start gap-2.5 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700 focus:ring-teal-500"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="font-medium text-teal-700 underline underline-offset-2">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="font-medium text-teal-700 underline underline-offset-2">
                Privacy Policy
              </Link>
              , including the{" "}
              <Link href="/refund-policy" className="font-medium text-teal-700 underline underline-offset-2">
                Refund &amp; Cancellation Policy
              </Link>
              .
            </span>
          </label>
          {fieldErrors.terms && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.terms}</p>}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-teal-700 px-6 py-3.5 text-sm font-extrabold text-white shadow-[0_10px_22px_rgba(15,118,110,0.35)] transition hover:bg-teal-800 disabled:opacity-60"
        >
          {submitting
            ? "Please wait…"
            : selectedDoctor?.consultation_fee != null
              ? `Continue to payment (PKR ${selectedDoctor.consultation_fee})`
              : "Continue to payment"}
        </button>
        <p className="text-center text-xs text-ink-500">
          No account or password needed. After paying you&rsquo;ll get a link to your appointment.
        </p>
      </form>
    </Shell>
  );
}
