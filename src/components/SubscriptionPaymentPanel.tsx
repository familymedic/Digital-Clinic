"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Doctor onboarding, step 6 (2026-09-21): the actual "how do I pay and
// show you I paid" panel, used in two places in DoctorShell — inline,
// collapsed behind a "Recharge now" link, on an otherwise-normal
// dashboard when a doctor's period is about to end (renewSoon), and
// always-visible, embedded in the full lock screen, once it actually
// has. Same component either way so there's exactly one upload flow to
// maintain, not two.
//
// Payment itself happens OUTSIDE this app (a real bank transfer or
// JazzCash payment, per the physician's explicit instruction — no
// Safepay checkout link for this fee) — this panel's job is just to
// show the doctor where to send it and let them attach proof
// afterward. Admin reviews that proof at /admin/subscriptions and
// clicks "Mark paid" — the existing action from Phase 10, unchanged.

interface PlatformSettings {
  doctor_subscription_bank_details: string | null;
  doctor_subscription_jazzcash_details: string | null;
}

interface LatestProof {
  id: string;
  method: "bank_transfer" | "jazzcash";
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];

export default function SubscriptionPaymentPanel({ doctorId }: { doctorId: string }) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [latestProof, setLatestProof] = useState<LatestProof | null | undefined>(undefined);
  const [method, setMethod] = useState<"bank_transfer" | "jazzcash">("bank_transfer");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("platform_settings")
      .select("doctor_subscription_bank_details, doctor_subscription_jazzcash_details")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setSettings(data as PlatformSettings | null));
  }, []);

  useEffect(() => {
    if (!supabase || !doctorId) return;
    supabase
      .from("doctor_subscription_payment_proofs")
      .select("id, method, status, created_at")
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatestProof((data as LatestProof | null) ?? null));
  }, [doctorId, submitted]);

  async function handleSubmit() {
    if (!supabase || !file) return;
    setSubmitError(null);
    if (file.size > MAX_FILE_BYTES) {
      setSubmitError("That file is too large — 10 MB max.");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setSubmitError("Please attach a PNG, JPG, HEIC, WEBP, or PDF file.");
      return;
    }
    setSubmitting(true);
    const path = `${doctorId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("doctor-subscription-proofs")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setSubmitting(false);
      setSubmitError(uploadError.message);
      return;
    }
    const { error: insertError } = await supabase.from("doctor_subscription_payment_proofs").insert({
      doctor_id: doctorId,
      method,
      file_path: path,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      note: note.trim() || null,
    });
    setSubmitting(false);
    if (insertError) {
      setSubmitError(insertError.message);
      return;
    }
    setFile(null);
    setNote("");
    setSubmitted((s) => !s); // toggles to re-trigger the latest-proof refetch above
  }

  const bankDetails = settings?.doctor_subscription_bank_details?.trim();
  const jazzcashDetails = settings?.doctor_subscription_jazzcash_details?.trim();

  return (
    <div className="space-y-5 text-left">
      {latestProof && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            latestProof.status === "approved"
              ? "border-teal-200 bg-teal-50 text-teal-800"
              : latestProof.status === "rejected"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {latestProof.status === "pending" &&
            `Proof submitted ${new Date(latestProof.created_at).toLocaleDateString()} — awaiting review.`}
          {latestProof.status === "approved" &&
            "Your last payment proof was approved. If you're still seeing this, your new period may not have started yet — check back shortly."}
          {latestProof.status === "rejected" &&
            "Your last payment proof was rejected. Please double-check the amount/reference and submit a new one below."}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-border bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-400">Bank transfer</div>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-700">
            {bankDetails || "Bank details haven't been added yet — contact the clinic directly."}
          </p>
        </div>
        <div className="rounded-xl border border-ink-border bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-400">JazzCash</div>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-700">
            {jazzcashDetails || "JazzCash details haven't been added yet — contact the clinic directly."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-ink-border bg-white p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-ink-400">Already paid? Attach proof</div>

        <div className="mt-3 flex gap-4 text-sm text-ink-700">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={method === "bank_transfer"}
              onChange={() => setMethod("bank_transfer")}
            />
            Bank transfer
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={method === "jazzcash"} onChange={() => setMethod("jazzcash")} />
            JazzCash
          </label>
        </div>

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-sm text-ink-700"
        />

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          placeholder="Optional note — e.g. transaction reference"
          rows={2}
          className="mt-3 w-full rounded-lg border border-ink-border px-3 py-2 text-sm"
        />

        {submitError && <p className="mt-2 text-sm text-red-700">{submitError}</p>}

        <button
          onClick={handleSubmit}
          disabled={!file || submitting}
          className="mt-3 rounded-full bg-amber-700 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit payment proof"}
        </button>
      </div>
    </div>
  );
}
