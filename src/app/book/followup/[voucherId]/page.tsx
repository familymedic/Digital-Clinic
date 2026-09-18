"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { COMPLAINTS } from "@/lib/complaints";

// The patient-side half of the free-follow-up voucher mechanism
// (2026-09-18, migration 0041). Deliberately its own page rather than
// folded into /book's existing multi-step state machine — the patient
// and doctor are already fixed by the voucher, so this only ever asks
// what a normal booking asks for the complaint/delivery step onward,
// then calls redeem_followup_voucher() instead of inserting a
// consultation directly and sending the patient to payment. On
// success there is no payment page at all for this visit.

type DeliveryMode = "text" | "audio" | "video";

const DELIVERY_OPTIONS: { value: DeliveryMode; label: string; description: string }[] = [
  {
    value: "text",
    label: "Text (portal messages)",
    description: "You and the doctor exchange messages through your dashboard, at your own pace.",
  },
  { value: "audio", label: "Audio call", description: "A phone-style call at a time slot you pick." },
  { value: "video", label: "Video call", description: "A video visit at a time slot you pick." },
];

interface VoucherRow {
  id: string;
  status: "active" | "consumed" | "revoked";
  note: string | null;
  expires_at: string | null;
  doctor_id: string;
  patient: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
}

interface OpenSlot {
  id: string;
  doctor_id: string;
  start_time: string;
  capacity: number;
  remaining: number;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function RedeemFollowUp() {
  const router = useRouter();
  const params = useParams<{ voucherId: string }>();
  const { session, loading } = useAuth();

  const [voucher, setVoucher] = useState<VoucherRow | null | undefined>(undefined);
  const [doctorName, setDoctorName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [complaint, setComplaint] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("text");
  const [openSlots, setOpenSlots] = useState<OpenSlot[] | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    const client = supabase;
    let cancelled = false;

    client
      .from("consultation_followup_vouchers")
      .select("id, status, note, expires_at, doctor_id, patient:family_members(id, full_name)")
      .eq("id", params.voucherId)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          return;
        }
        setVoucher(data as VoucherRow | null);
        if (data?.doctor_id) {
          const { data: doctor } = await client
            .from("public_doctor_directory")
            .select("full_name")
            .eq("id", data.doctor_id)
            .maybeSingle();
          if (!cancelled) setDoctorName(doctor?.full_name ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session, params.voucherId]);

  useEffect(() => {
    if (!supabase || deliveryMode === "text" || !voucher) return;
    supabase.rpc("list_open_slots").then(({ data, error }) => {
      if (!error && data) setOpenSlots(data as OpenSlot[]);
    });
  }, [deliveryMode, voucher]);

  const doctorSlots = voucher ? (openSlots ?? []).filter((s) => s.doctor_id === voucher.doctor_id) : [];

  async function handleSubmit() {
    if (!supabase || !voucher || !complaint) return;
    if (deliveryMode !== "text" && !selectedSlotId) return;
    setSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase.rpc("redeem_followup_voucher", {
      p_voucher_id: voucher.id,
      p_complaint: complaint,
      p_delivery_mode: deliveryMode,
      p_slot_id: deliveryMode !== "text" ? selectedSlotId : null,
    });

    setSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so this can&rsquo;t be booked.
          </div>
        </div>
      </div>
    );
  }

  if (loading || voucher === undefined) {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 text-sm text-slate-500 sm:px-6">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p>Please log in first.</p>
            <Link href="/login" className="mt-3 inline-block font-medium text-teal-700 underline underline-offset-2">
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !voucher) {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError ?? "This free follow-up link isn't available to you."}
          </div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (voucher.status !== "active") {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            {voucher.status === "consumed"
              ? "This free follow-up has already been booked."
              : "This free follow-up is no longer available."}
          </div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
    return (
      <div>
        <PageHeader title="Free follow-up" />
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This free follow-up expired on {new Date(voucher.expires_at).toLocaleDateString()}. Please contact
            the clinic if you still need to be seen.
          </div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const patient = one(voucher.patient);

  return (
    <div>
      <PageHeader
        title="Book your free follow-up"
        subtitle={doctorName ? `With ${doctorName} — no payment needed for this visit.` : "No payment needed for this visit."}
      />
      <div className="mx-auto max-w-md space-y-6 px-4 py-10 sm:px-6">
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          Booking for <span className="font-semibold">{patient?.full_name ?? "your family member"}</span>
          {voucher.note && <span className="block text-xs text-teal-800/80">Doctor&rsquo;s note: {voucher.note}</span>}
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700">What&rsquo;s this follow-up about?</p>
          <div className="mt-2 space-y-2">
            {COMPLAINTS.map((c) => (
              <button
                key={c}
                onClick={() => setComplaint(c)}
                className={`block w-full rounded-lg border px-4 py-2.5 text-left text-sm shadow-sm transition ${
                  complaint === c ? "border-teal-600 bg-teal-50 font-semibold text-teal-800" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {complaint && (
          <div>
            <p className="text-sm font-medium text-slate-700">How would you like this visit?</p>
            <div className="mt-2 space-y-2">
              {DELIVERY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setDeliveryMode(opt.value);
                    setSelectedSlotId(null);
                  }}
                  className={`block w-full rounded-lg border px-4 py-3 text-left shadow-sm transition ${
                    deliveryMode === opt.value ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900">{opt.label}</span>
                  <span className="block text-xs text-slate-500">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {complaint && deliveryMode !== "text" && (
          <div>
            <p className="text-sm font-medium text-slate-700">Pick a time</p>
            {doctorSlots.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No open slots right now — please check back soon.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {doctorSlots.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSlotId(s.id)}
                    disabled={s.remaining <= 0}
                    className={`block w-full rounded-lg border px-4 py-2.5 text-left text-sm shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedSlotId === s.id ? "border-teal-600 bg-teal-50 font-semibold text-teal-800" : "border-slate-200 bg-white hover:border-teal-300"
                    }`}
                  >
                    {new Date(s.start_time).toLocaleString()} — {s.remaining} spot{s.remaining === 1 ? "" : "s"} left
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {submitError && <p className="text-sm font-medium text-red-700">{submitError}</p>}

        {complaint && (deliveryMode === "text" || selectedSlotId) && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-md bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Booking…" : "Confirm — no payment needed"}
          </button>
        )}
      </div>
    </div>
  );
}
