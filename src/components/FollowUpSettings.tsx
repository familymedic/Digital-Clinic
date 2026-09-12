"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Phase 7 / Section 16: follow-up fee control. The doctor marks — after
// this consultation is already booked normally — that it's a follow-up
// to an earlier consultation for the same patient, and whether it's the
// standard fee or waived. No refund logic here (Phase 10, once a real
// payment gateway exists); this is purely the doctor-administrative
// record, not shown to the patient yet.

interface PriorConsultation {
  id: string;
  complaint: string;
  created_at: string;
}

interface Props {
  consultationId: string;
  doctorId: string;
  patientId: string;
}

export default function FollowUpSettings({ consultationId, doctorId, patientId }: Props) {
  const [priorConsultations, setPriorConsultations] = useState<PriorConsultation[] | null>(null);
  const [followUpTo, setFollowUpTo] = useState<string>("");
  const [feeStatus, setFeeStatus] = useState<"standard" | "waived">("standard");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    Promise.all([
      supabase
        .from("consultations")
        .select("id, complaint, created_at")
        .eq("patient_id", patientId)
        .neq("id", consultationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("consultation_followups")
        .select("follow_up_to, fee_status, updated_at")
        .eq("consultation_id", consultationId)
        .maybeSingle(),
    ]).then(([priorRes, existingRes]) => {
      if (cancelled) return;
      if (priorRes.error) {
        setLoadError(priorRes.error.message);
        return;
      }
      setPriorConsultations(priorRes.data as PriorConsultation[]);

      if (existingRes.error) {
        setLoadError(existingRes.error.message);
        return;
      }
      if (existingRes.data) {
        setFollowUpTo(existingRes.data.follow_up_to);
        setFeeStatus(existingRes.data.fee_status as "standard" | "waived");
        setSavedAt(existingRes.data.updated_at);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [consultationId, patientId]);

  async function handleSave() {
    if (!supabase || !followUpTo) return;
    setSaving(true);
    setSaveError(null);

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("consultation_followups").upsert(
      {
        consultation_id: consultationId,
        follow_up_to: followUpTo,
        fee_status: feeStatus,
        doctor_id: doctorId,
        updated_at: nowIso,
      },
      { onConflict: "consultation_id" }
    );

    setSaving(false);
    if (error) {
      setSaveError(error.message);
    } else {
      setSavedAt(nowIso);
    }
  }

  if (loadError) {
    return <p className="text-sm text-red-700">Couldn&rsquo;t load follow-up settings: {loadError}</p>;
  }

  if (priorConsultations === null) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  if (priorConsultations.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        This patient has no earlier consultations yet, so there&rsquo;s nothing for this one to
        follow up on.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">This consultation follows up on</label>
        <select
          value={followUpTo}
          onChange={(e) => setFollowUpTo(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— Not a follow-up —</option>
          {priorConsultations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.complaint} · {new Date(c.created_at).toLocaleDateString()}
            </option>
          ))}
        </select>
      </div>

      {followUpTo && (
        <div>
          <label className="block text-sm font-medium text-slate-700">Fee for this follow-up</label>
          <div className="mt-1 flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="fee_status"
                checked={feeStatus === "standard"}
                onChange={() => setFeeStatus("standard")}
              />
              Standard (PKR 500)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="fee_status"
                checked={feeStatus === "waived"}
                onChange={() => setFeeStatus("waived")}
              />
              Waived (free)
            </label>
          </div>
        </div>
      )}

      {saveError && <p className="text-sm text-red-700">{saveError}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!followUpTo || saving}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && !saving && (
          <span className="text-xs text-slate-400">Saved {new Date(savedAt).toLocaleString()}</span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        This only records the fee decision for later billing (Phase 10) — nothing is charged or
        refunded automatically yet, and the patient doesn&rsquo;t see this yet.
      </p>
    </div>
  );
}
