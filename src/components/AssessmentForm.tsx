"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Phase 7: the doctor's assessment/plan for a consultation (Section 15).
// Step 3 built draft entry. Step 4 adds the deliberate "Approve & Issue"
// action — once issued, the record locks (RLS itself refuses further
// edits, see 0018) and the patient can see it for the first time
// (src/app/consultation/[id]/prescription).

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
  const [status, setStatus] = useState<"draft" | "issued" | null>(null);
  const [issuedAt, setIssuedAt] = useState<string | null>(null);
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [hasSavedOnce, setHasSavedOnce] = useState(false);

  async function load() {
    if (!supabase) return;
    const [assessmentRes, medsRes] = await Promise.all([
      supabase
        .from("consultation_assessments")
        .select("assessment, advice, referral, follow_up_date, follow_up_reason, updated_at, status, issued_at")
        .eq("consultation_id", consultationId)
        .maybeSingle(),
      supabase
        .from("consultation_medications")
        .select("id, medication_name, dosage, instructions")
        .eq("consultation_id", consultationId)
        .order("position", { ascending: true }),
    ]);

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
      setStatus(assessmentRes.data.status as "draft" | "issued");
      setIssuedAt(assessmentRes.data.issued_at);
      setHasSavedOnce(true);
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
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Returns an error message on failure, or null on success. Shared by
  // "Save draft" and "Approve & Issue" (which saves the latest edits
  // first, so issuing can never finalize stale content the doctor typed
  // but never explicitly saved). Returning the message directly, rather
  // than relying on the saveError state, avoids reading a stale value
  // from before React re-renders.
  async function persistDraft(): Promise<string | null> {
    if (!supabase) return "Not connected.";

    const { error: assessmentError } = await supabase.from("consultation_assessments").upsert(
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

    if (assessmentError) return assessmentError.message;

    // Medications: replace the whole set on every save. Simple and
    // correct for a draft that's edited as a form, not diffed line by
    // line — nothing else references a medication row by id.
    const { error: deleteError } = await supabase
      .from("consultation_medications")
      .delete()
      .eq("consultation_id", consultationId);

    if (deleteError) return deleteError.message;

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

      if (insertError) return insertError.message;
    }

    setHasSavedOnce(true);
    return null;
  }

  async function saveDraft() {
    setSaving(true);
    setSaveError(null);
    const err = await persistDraft();
    setSaving(false);
    if (err) {
      setSaveError(err);
    } else {
      setLastSavedAt(new Date().toISOString());
    }
  }

  async function confirmIssue() {
    if (!supabase) return;
    setIssuing(true);
    setIssueError(null);

    const persistError = await persistDraft();
    if (persistError) {
      setIssuing(false);
      setIssueError(persistError);
      return;
    }

    const { error } = await supabase
      .from("consultation_assessments")
      .update({ status: "issued" })
      .eq("consultation_id", consultationId);

    setIssuing(false);

    if (error) {
      setIssueError(error.message);
      return;
    }

    setConfirmingIssue(false);
    await load();
  }

  if (loading) {
    return <p className="mt-2 text-sm text-slate-400">Loading…</p>;
  }

  const isIssued = status === "issued";

  return (
    <div className="mt-3 space-y-4">
      {loadError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&rsquo;t load your saved draft: {loadError}
        </div>
      )}

      {isIssued && (
        <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          Issued to the patient {issuedAt ? new Date(issuedAt).toLocaleString() : ""}. This is now
          final and can no longer be edited here.
        </div>
      )}

      <fieldset disabled={isIssued} className="space-y-4 disabled:opacity-70">
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
              <div
                key={m.id ?? i}
                className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_2fr_auto]"
              >
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
          {!isIssued && (
            <button
              type="button"
              onClick={addMedicationLine}
              className="mt-2 text-xs font-medium text-teal-700 underline underline-offset-2"
            >
              + Add another medicine
            </button>
          )}
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
      </fieldset>

      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&rsquo;t save: {saveError}
        </div>
      )}

      {!isIssued && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving || issuing}
              className="rounded-md bg-white px-5 py-2 text-sm font-semibold text-teal-700 shadow-sm ring-1 ring-inset ring-teal-600 transition hover:bg-teal-50 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>

            {!confirmingIssue && (
              <button
                type="button"
                onClick={() => setConfirmingIssue(true)}
                disabled={saving || issuing}
                className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
              >
                Approve &amp; Issue
              </button>
            )}

            {lastSavedAt && !confirmingIssue && (
              <span className="text-xs text-slate-400">
                Last saved {new Date(lastSavedAt).toLocaleString()}
              </span>
            )}
          </div>

          {confirmingIssue && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Issue this to the patient?</p>
              <p className="mt-1">
                This saves your latest changes, locks the assessment and prescription so they can no
                longer be edited, and lets the patient see it for the first time. This can&rsquo;t be
                undone here.
              </p>
              {issueError && <p className="mt-2 font-medium text-red-700">{issueError}</p>}
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={confirmIssue}
                  disabled={issuing}
                  className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800 disabled:opacity-60"
                >
                  {issuing ? "Issuing…" : "Yes, approve & issue"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingIssue(false);
                    setIssueError(null);
                  }}
                  disabled={issuing}
                  className="rounded-md px-4 py-2 text-sm font-medium text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400">
            {hasSavedOnce
              ? "A saved draft is visible only to you until you Approve & Issue it."
              : "Nothing is saved yet — click Save draft to keep your notes, or Approve & Issue when ready to finalize."}
          </p>
        </>
      )}
    </div>
  );
}
