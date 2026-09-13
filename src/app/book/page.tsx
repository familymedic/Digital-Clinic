"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AddFamilyMemberForm from "@/components/AddFamilyMemberForm";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";

const complaints = [
  "Fever",
  "Cough",
  "Sore throat",
  "Abdominal pain",
  "Diarrhea / vomiting",
  "Headache",
  "Back pain",
  "Urinary symptoms",
  "Shortness of breath",
  "Chest pain",
  "Other",
];

type DeliveryMode = "text" | "audio" | "video";

const DELIVERY_OPTIONS: { value: DeliveryMode; label: string; description: string }[] = [
  {
    value: "text",
    label: "Text (portal messages)",
    description: "You and the doctor exchange messages through your dashboard, at your own pace.",
  },
  {
    value: "audio",
    label: "Audio call",
    description: "A phone-style call at a time slot you pick.",
  },
  {
    value: "video",
    label: "Video call",
    description: "A video visit at a time slot you pick.",
  },
];

interface OpenSlot {
  id: string;
  start_time: string;
  capacity: number;
  remaining: number;
}

export default function Book() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("text");
  const [showSlotPicker, setShowSlotPicker] = useState(false);
  const [openSlots, setOpenSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOpenSlots() {
    if (!supabase) return;
    setOpenSlots(null);
    setSlotsError(null);
    const { data, error: rpcError } = await supabase.rpc("list_open_slots");
    if (rpcError) {
      setSlotsError(rpcError.message);
    } else {
      setOpenSlots(data as OpenSlot[]);
    }
  }

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("family_members")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setFamilyError(error.message);
        } else {
          setFamilyMembers(data as FamilyMember[]);
        }
      });
  }, [session]);

  async function confirmBooking() {
    if (!supabase || !session || !selectedMember || !selectedComplaint) return;
    if (deliveryMode !== "text" && !selectedSlotId) return;
    setSubmitting(true);
    setError(null);

    const { data: created, error: insertError } = await supabase
      .from("consultations")
      .insert({
        patient_id: selectedMember.id,
        complaint: selectedComplaint,
        delivery_mode: deliveryMode,
        ...(deliveryMode !== "text" ? { slot_id: selectedSlotId } : {}),
      })
      .select("id")
      .single();

    if (insertError || !created) {
      setSubmitting(false);
      setError(insertError?.message ?? "Something went wrong — please try again.");
      // The slot may have just filled up (or been removed) between
      // loading the list and submitting — refresh it so the picker
      // reflects reality rather than showing a slot that's actually
      // gone.
      if (deliveryMode !== "text") {
        setSelectedSlotId(null);
        loadOpenSlots();
      }
      return;
    }

    // The consultation is saved (as 'pending_payment' — see 0024) — now
    // start the actual PKR 500 payment. If that step itself fails for
    // some reason (Safepay unreachable, etc.), the booking isn't lost:
    // send the patient to the payment page, which offers a retry
    // button rather than losing the booking.
    const { data: authData } = await supabase.auth.getSession();
    if (!authData.session) {
      router.push(`/consultation/${created.id}/payment`);
      return;
    }
    try {
      const res = await fetch(`/api/consultations/${created.id}/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
    } catch {
      // fall through to the payment page below
    }
    setSubmitting(false);
    router.push(`/consultation/${created.id}/payment`);
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so bookings can&rsquo;t
            be saved. This page will work once a Supabase project is
            connected.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Book a consultation" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in or create an account first to book a consultation.</p>
            <div className="mt-4 flex gap-4">
              <Link href="/login" className="font-medium text-teal-700 underline underline-offset-2">
                Log in
              </Link>
              <Link href="/register" className="font-medium text-teal-700 underline underline-offset-2">
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: who is this consultation for?
  if (!selectedMember) {
    return (
      <div>
        <PageHeader
          title="Book a consultation"
          subtitle="First, who is this visit for?"
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          {familyError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load family members: {familyError}
            </div>
          )}

          {!familyError && familyMembers === null && (
            <p className="text-sm text-slate-400">Loading…</p>
          )}

          {!familyError && familyMembers && familyMembers.length > 0 && (
            <div className="space-y-2">
              {familyMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMember(m)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-teal-600"
                >
                  <span className="text-sm font-medium text-slate-900">{m.full_name}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 text-sm font-medium text-teal-700 underline underline-offset-2"
            >
              + Someone else in your family
            </button>
          )}

          {showAddForm && (
            <div className="mt-4">
              <AddFamilyMemberForm
                onAdded={(member) => {
                  setFamilyMembers((prev) => [...(prev ?? []), member]);
                  setShowAddForm(false);
                  setSelectedMember(member);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 2: what's the complaint?
  if (!selectedComplaint) {
    return (
      <div>
        <PageHeader
          title="Book a consultation"
          subtitle="A PKR 500 consultation fee is paid securely after you confirm your booking details."
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="mb-6 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            <span>
              Booking for <span className="font-semibold">{selectedMember.full_name}</span>
            </span>
            <button
              onClick={() => setSelectedMember(null)}
              className="text-xs font-medium underline underline-offset-2"
            >
              Change
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {complaints.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedComplaint(c)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-600 hover:text-teal-700"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Step 4: pick a time slot (audio/video only).
  if (showSlotPicker && deliveryMode !== "text") {
    return (
      <div>
        <PageHeader
          title="Book a consultation"
          subtitle="Pick an available time"
        />
        <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
          <div className="mb-6 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            <span>
              {DELIVERY_OPTIONS.find((o) => o.value === deliveryMode)?.label} · {selectedComplaint} for{" "}
              <span className="font-semibold">{selectedMember.full_name}</span>
            </span>
            <button
              onClick={() => {
                setShowSlotPicker(false);
                setSelectedSlotId(null);
              }}
              className="text-xs font-medium underline underline-offset-2"
            >
              Change
            </button>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t book that: {error}
            </div>
          )}

          {slotsError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&rsquo;t load available times: {slotsError}
            </div>
          )}

          {!slotsError && openSlots === null && (
            <p className="text-sm text-slate-400">Loading available times…</p>
          )}

          {!slotsError && openSlots && openSlots.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No open times right now. Please check back soon, or choose text instead.
            </div>
          )}

          {!slotsError && openSlots && openSlots.length > 0 && (
            <div className="space-y-2">
              {openSlots.map((slot) => (
                <label
                  key={slot.id}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-sm shadow-sm transition ${
                    selectedSlotId === slot.id
                      ? "border-teal-600 bg-teal-50"
                      : "border-slate-200 bg-white hover:border-teal-300"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="slot"
                      checked={selectedSlotId === slot.id}
                      onChange={() => setSelectedSlotId(slot.id)}
                    />
                    <span className="font-medium text-slate-900">
                      {new Date(slot.start_time).toLocaleString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">
                    {slot.remaining} spot{slot.remaining === 1 ? "" : "s"} left
                  </span>
                </label>
              ))}
            </div>
          )}

          <button
            onClick={confirmBooking}
            disabled={submitting || !selectedSlotId}
            className="mt-6 w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Booking…" : "Continue to payment"}
          </button>
        </div>
      </div>
    );
  }

  // Step 3: how would you like this delivered?
  return (
    <div>
      <PageHeader
        title="Book a consultation"
        subtitle="How would you like this consultation delivered?"
      />
      <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <span>
            {selectedComplaint} for <span className="font-semibold">{selectedMember.full_name}</span>
          </span>
          <button
            onClick={() => setSelectedComplaint(null)}
            className="text-xs font-medium underline underline-offset-2"
          >
            Change
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t book that: {error}
          </div>
        )}

        <div className="space-y-2">
          {DELIVERY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm transition ${
                deliveryMode === opt.value
                  ? "border-teal-600 bg-teal-50"
                  : "border-slate-200 bg-white hover:border-teal-300"
              }`}
            >
              <input
                type="radio"
                name="delivery_mode"
                className="mt-1"
                checked={deliveryMode === opt.value}
                onChange={() => setDeliveryMode(opt.value)}
              />
              <span>
                <span className="block font-medium text-slate-900">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>

        <button
          onClick={() => {
            if (deliveryMode === "text") {
              confirmBooking();
            } else {
              setError(null);
              setShowSlotPicker(true);
              loadOpenSlots();
            }
          }}
          disabled={submitting}
          className="mt-6 w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Booking…" : deliveryMode === "text" ? "Continue to payment" : "See available times"}
        </button>
      </div>
    </div>
  );
}
