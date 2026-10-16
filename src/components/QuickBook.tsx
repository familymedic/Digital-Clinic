"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
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
  { value: "text", label: "Text (portal messages)", description: "You and the doctor exchange messages, at your own pace." },
  { value: "audio", label: "Audio call", description: "A phone-style call at a time you pick." },
  { value: "video", label: "Video call", description: "A video visit at a time you pick." },
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

const BACK_BTN =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-700 shadow-sm transition hover:border-teal-500 hover:bg-teal-50";
const PRIMARY_BTN =
  "mt-6 w-full rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50";

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

  const summary = selectedDoctor && (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
      <span>
        <span className="font-semibold">{selectedDoctor.full_name}</span>
        {selectedDoctor.consultation_fee != null && <> &middot; PKR {selectedDoctor.consultation_fee}</>}
        {currentStep !== "when" && (
          <span className="block text-xs text-teal-800">
            {MODES.find((m) => m.value === deliveryMode)?.label}
            {selectedSlot &&
              ` · ${new Date(selectedSlot.start_time).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`}
            {currentStep === "details" && complaint ? ` · ${complaint}` : ""}
          </span>
        )}
      </span>
    </div>
  );

  if (currentStep === "doctor") {
    return (
      <div>
        <PageHeader title="Book a consultation" subtitle="Which doctor would you like to see?" />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {doctorsError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load doctors: {doctorsError}
            </div>
          )}
          {!doctorsError && doctors === null && <p className="text-sm text-ink-500">Loading doctors…</p>}
          {!doctorsError && doctors && doctors.length === 0 && (
            <div className="rounded-3xl border border-dashed border-[#d7e7e2] bg-white p-6 text-center text-sm text-ink-500">
              No doctors are available to book right now. Please check back soon.
            </div>
          )}
          {!doctorsError && doctors && doctors.length > 0 && (
            <div className="space-y-2">
              {specialties.map((spec) => (
                <div key={spec}>
                  <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500 first:mt-0">{spec}</p>
                  {doctors
                    .filter((d) => (d.specialty ?? "Other") === spec)
                    .map((d) => (
                      <button
                        key={d.id}
                        onClick={() => {
                          setPickedDoctor(d);
                          setStep("when");
                        }}
                        className="mb-2 flex w-full items-center justify-between rounded-xl border border-[#d7e7e2] bg-white px-4 py-3 text-left shadow-sm transition hover:border-teal-600"
                      >
                        <span className="text-sm font-medium text-ink-900">{d.full_name}</span>
                        <span className="rounded-full bg-[#e6f1ed] px-2.5 py-1 text-xs font-medium text-ink-700">
                          PKR {d.consultation_fee}
                        </span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
          <p className="mt-8 text-center text-sm text-ink-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (currentStep === "when") {
    return (
      <div>
        <PageHeader title="Book a consultation" subtitle="How and when would you like to see the doctor?" />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {summary}
          {!fromLink && (
            <button onClick={() => { setPickedDoctor(null); setStep("doctor"); }} className={`${BACK_BTN} mb-4`}>
              ← Choose a different doctor
            </button>
          )}
          {error && (
            <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t book that: {error}
            </div>
          )}
          {dayFull && capacityStatus && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {selectedDoctor?.full_name} has reached their maximum of {capacityStatus.daily_cap} patients for today.
              Please try again tomorrow or choose a different doctor.
            </div>
          )}

          <div className="space-y-2">
            {MODES.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm transition ${
                  deliveryMode === opt.value ? "border-teal-600 bg-teal-50" : "border-[#d7e7e2] bg-white hover:border-teal-300"
                }`}
              >
                <input
                  type="radio"
                  name="delivery_mode"
                  className="mt-1"
                  checked={deliveryMode === opt.value}
                  onChange={() => chooseMode(opt.value)}
                />
                <span>
                  <span className="block font-medium text-ink-900">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{opt.description}</span>
                  {opt.value === "text" && textStatus && (
                    <span className={`mt-1 block text-xs font-medium ${textStatus.is_open ? "text-teal-700" : "text-amber-700"}`}>
                      {textStatus.is_open
                        ? `Open now${textStatus.remaining != null ? ` — ${textStatus.remaining} left today` : ""}`
                        : textStatus.remaining === 0
                          ? "Fully booked for text today — try again tomorrow, or choose audio/video."
                          : textStatus.start_time && textStatus.end_time
                            ? `Closed right now — available ${formatHHMM(textStatus.start_time)}–${formatHHMM(textStatus.end_time)} (Pakistan time).`
                            : "Not available for text right now."}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>

          {deliveryMode !== "text" && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-semibold text-ink-900">Pick an available time</p>
              {slotsState.status === "loading" && <p className="text-sm text-ink-500">Loading available times…</p>}
              {slotsState.status === "error" && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {slotsState.message}
                  <button onClick={() => void loadSlots()} className="ml-2 font-semibold underline underline-offset-2">
                    Try again
                  </button>
                </div>
              )}
              {slotsState.status === "ready" && doctorSlots.length === 0 && (
                <div className="rounded-3xl border border-dashed border-[#d7e7e2] bg-white p-6 text-center text-sm text-ink-500">
                  No open times right now for {selectedDoctor?.full_name}. Please check back soon, or choose a text
                  consultation.
                </div>
              )}
              {slotsState.status === "ready" && doctorSlots.length > 0 && (
                <div className="space-y-2">
                  {doctorSlots.map((slot) => (
                    <label
                      key={slot.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-sm shadow-sm transition ${
                        selectedSlotId === slot.id ? "border-teal-600 bg-teal-50" : "border-[#d7e7e2] bg-white hover:border-teal-300"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="slot"
                          checked={selectedSlotId === slot.id}
                          onChange={() => setSelectedSlotId(slot.id)}
                        />
                        <span className="font-medium text-ink-900">
                          {new Date(slot.start_time).toLocaleString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      <span className="text-xs text-ink-500">
                        {slot.remaining} spot{slot.remaining === 1 ? "" : "s"} left
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => {
              setError(null);
              setStep("reason");
            }}
            disabled={!whenReady}
            className={PRIMARY_BTN}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (currentStep === "reason") {
    return (
      <div>
        <PageHeader title="Book a consultation" subtitle="What is the main reason for the visit?" />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {summary}
          <button onClick={() => setStep("when")} className={`${BACK_BTN} mb-4`}>
            ← Back
          </button>
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            <span className="font-semibold">Not for emergencies.</span> If you or your family member has severe chest pain,
            trouble breathing, heavy bleeding, fainting, or any sudden severe symptom, go to the nearest emergency room or
            contact your local emergency service now &mdash; don&rsquo;t wait for an online consultation.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {COMPLAINTS.map((c) => (
              <button
                key={c}
                onClick={() => setComplaint(c)}
                aria-pressed={complaint === c}
                className={`rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition ${
                  complaint === c
                    ? "border-teal-600 bg-teal-50 text-teal-800"
                    : "border-[#d7e7e2] bg-white text-ink-700 hover:border-teal-600 hover:text-teal-700"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {(complaint === "Chest pain" || complaint === "Shortness of breath") && (
            <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
              <p className="font-semibold">This can be an emergency.</p>
              <p className="mt-1">
                If the {complaint.toLowerCase()} is severe, sudden, or getting worse, go to the nearest emergency room now
                instead of booking an online consultation. Only continue if it is mild and you are safe to wait.
              </p>
            </div>
          )}
          <button onClick={() => setStep("details")} disabled={!complaint} className={PRIMARY_BTN}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  // details
  return (
    <div>
      <PageHeader
        title="Book a consultation"
        subtitle="Last step: who is the patient? Then you pay securely to confirm."
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        {summary}
        <button onClick={() => setStep("reason")} disabled={submitting} className={`${BACK_BTN} mb-4`}>
          ← Back
        </button>
        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
          className="space-y-5 rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]"
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
              <label className="mt-3 flex items-start gap-2.5 rounded-lg bg-[#f1f8f5] p-3 text-sm text-ink-700">
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
            className="w-full rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-teal-700 hover:to-teal-800 disabled:opacity-60"
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
      </div>
    </div>
  );
}
