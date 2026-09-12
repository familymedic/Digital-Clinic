"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Phase 7, step 3 (Section 15): the doctor's draft assessment/plan for a
// consultation. Draft-only — there is no "Approve & Issue" action yet
// (that, and the patient-facing view, are the next increment), so
// every save here just writes/updates a `status = 'draft'` row. Nothing
// in this component is ever shown to a patient.

interface MedicationLine {
  id?: string; // present once saved; absent for a not-yet-saved row
  medication_name: string;
  dosage: string;
  instructions: string;
}

const emptyLine = (): MedicationLine => ({ medication_name: "", dosage: "", instructions: "" });

interface AssessmentFields {
  assessment: string;
  advice: string;
  referral: string;
  follow_up_date: string;
  follow_up_reason: string;
}

const emptyFields: AssessmentFields = {
  assessment: "",
  advice: "",
  referral: "",
  follow_up_date: "",
  follow_up_reason: "",
};

export default function AssessmentForm({
  consultationId,
  doctorId,
}: {
  consultationId: string;
  doctorId: string;
}) {
  const [fields, setFields] = useState<AssessmentFields>(emptyFields);
  const [medications, setMedications] = useState<MedicationLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const [assessmentRes, medsRes] = await Promise.all([
        supabase!
          .from("consultation_assessments")
          .select("assessment, advice, referral, follow_up_date, follow_up_reason, updated_at")
          .eq("consultation_id", consultationId)
          .maybeSingle(),
        supabase!
          .from("consultation_medications")
          .select("id, medication_name, dosage, instructions")
          .eq("consultation_id", consultationId)
          .order("position", { ascending: true }),
      ]);

      if (cancelled) return;

      if (assessmentRes.error) {
        setLoadError(assessmentRes.error.message);
      } else if (assessmentRes.data) {
        setFields({
          assessment: assessmentRes.data.assessment ?? "",
          advice: assessmentRes.data.advice ?? "",
          referral: assessmentRes.data.referral ?? "",
          follow_up_date: assessmentRes.data.follow_up_date ?? "",
          follow_up_reason: assessmentRes.data.follow_up_reason ?? "",
        });
        setLastSavedAt(assessmentRes.data.updated_at);
      }

      if (medsRes.error) {
        setLoadError((prev) => prev ?? medsRes.error.message);
      } else if (medsRes.data && medsRes.data.length > 0) {
        setMedications(
          medsRes.data.map((m) => ({
            id: m.id,
            medication_name: m.medication_name,
            dosage: m.dosage ?? "",
            instructions: m.instructions ?? "",
          }))
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [consultationId]);

  function updateField<K extends keyof AssessmentFields>(key: K, value: AssessmentFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function updateMedication(index: number, patch: Partial<MedicationLine>) {
    setMedications((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function addMedicationLine() {
    setMedications((prev) => [...prev, emptyLine()]);
  }

  function removeMedicationLine(index: number) {
    setMedications((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function saveDraft() {
    if (!supabase) return;
    setSaving(true);
    setSaveError(null);

    const { error: assessmentError } = await supabase
      .from("consultation_assessments")
      .upsert(
        {
          consultation_id: consultationId,
          doctor_id: doctorId,
          assessment: fields.assessment || null,
          advice: fields.advice || null,
          referral: fields.referral || null,
          follow_up_date: fields.follow_up_date || null,
          follow_up_reason: fields.follow_up_reason || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "consultation_id" }
      );

    if (assessmentError) {
      setSaving(false);
      setSaveError(assessmentError.message);
      return;
    }

    // Medications: replace the whole set on every save. Simple and
    // correct for a draft that's edited as a form, not diffed line by
    // line — nothing else references a medication row by id.
    const { error: deleteError } = await supabase
      .from("consultation_medications")
      .delete()
      .eq("consultation_id", consultationId);

    if (deleteError) {
      setSaving(false);
      setSaveError(deleteError.message);
      return;
    }

    const linesToSave = medications
      .map((m, i) => ({ ...m, position: i + 1 }))
      .filter((m) => m.medication_name.trim().length > 0);

    if (linesToSave.length > 0) {
      const { error: insertError } = await supabase.from("consultation_medications").insert(
        linesToSave.map((m) => ({
          consultation_id: consultationId,
          position: m.position,
          medication_name: m.medication_name.trim(),
          dosage: m.dosage.trim() || null,
          instructions: m.instructions.trim() || null,
        }))
      );

      if (insertError) {
        setSaving(false);
        setSaveError(insertError.message);
        return;
      }
    }

    setSaving(false);
    setLastSavedAt(new Date().toISOString());
  }

  if (loading) {
    return <p className="mt-2 text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="mt-3 space-y-4">
      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&rsquo;t load your saved draft: {loadError}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-500">Assessment / Diagnosis</label>
        <textarea
          value={fields.assessment}
          onChange={(e) => updateField("assessment", e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500">Prescription</label>
        <div className="mt-1 space-y-2">
          {medications.map((m, i) => (
            <div key={m.id ?? i} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
              <input
                value={m.medication_name}
                onChange={(e) => updateMedication(i, { medication_name: e.target.value })}
                placeholder="Medicine name"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={m.dosage}
                onChange={(e) => updateMedication(i, { dosage: e.target.value })}
                placeholder="Dosage (e.g. 500mg)"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={m.instructions}
                onChange={(e) => updateMedication(i, { instructions: e.target.value })}
                placeholder="Instructions (e.g. twice daily after food, 5 days)"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => removeMedicationLine(i)}
                disabled={medications.length === 1}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-red-600 disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addMedicationLine}
          className="mt-2 text-xs font-medium text-teal-700 underline underline-offset-2"
        >
          + Add another medicine
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500">Advice / Plan</label>
        <textarea
          value={fields.advice}
          onChange={(e) => updateField("advice", e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500">Referral</label>
        <textarea
          value={fields.referral}
          onChange={(e) => updateField("referral", e.target.value)}
          rows={2}
          placeholder="Leave blank if none"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-500">Follow-up date</label>
          <input
            type="date"
            value={fields.follow_up_date}
            onChange={(e) => updateField("follow_up_date", e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Follow-up reason</label>
          <input
            value={fields.follow_up_reason}
            onChange={(e) => updateField("follow_up_reason", e.target.value)}
            placeholder="Leave blank if no follow-up needed"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>
      </div>

      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&rsquo;t save: {saveError}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={saveDraft}
          disabled={saving}
          className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        {lastSavedAt && (
          <span className="text-xs text-slate-400">
            Last saved {new Date(lastSavedAt).toLocaleString()}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400">
        This is a working draft, visible only to you. The patient can&rsquo;t see any of this yet —
        that comes with a later step once there&rsquo;s a way to formally issue it.
      </p>
    </div>
  );
}
