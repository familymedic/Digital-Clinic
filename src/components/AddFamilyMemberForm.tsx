"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthProvider";
import { RELATIONSHIPS, isAdultDob, type FamilyMember } from "@/lib/family";

export default function AddFamilyMemberForm({
  onAdded,
  onCancel,
}: {
  onAdded: (member: FamilyMember) => void;
  onCancel?: () => void;
}) {
  const { session } = useAuth();
  const [fullName, setFullName] = useState("");
  const [relationship, setRelationship] = useState<string>(RELATIONSHIPS[0].value);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAdult = isAdultDob(dateOfBirth);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError("Please enter a full name.");
      return;
    }
    if (!dateOfBirth) {
      setError(
        "Please enter a date of birth — it's how we tell whether an attestation is needed."
      );
      return;
    }
    if (isAdult && !attest) {
      setError("Please confirm the attestation to add an adult family member.");
      return;
    }
    if (!supabase || !session) return;

    setSubmitting(true);
    const { data, error: insertError } = await supabase
      .from("family_members")
      .insert({
        account_id: session.user.id,
        full_name: fullName.trim(),
        relationship,
        date_of_birth: dateOfBirth,
        attestation_confirmed: isAdult ? attest : false,
        attestation_at: isAdult ? new Date().toISOString() : null,
      })
      .select()
      .single();
    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    onAdded(data as FamilyMember);
    setFullName("");
    setDateOfBirth("");
    setAttest(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600">Full name</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Ayesha Khan"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Relationship to you</label>
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Date of birth</label>
        <input
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Used only to tell adults and minor children apart. An adult you
          add needs to agree to it (below); a minor child doesn&rsquo;t.
        </p>
      </div>

      {dateOfBirth && isAdult && (
        <label className="flex items-start gap-2.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={attest}
            onChange={(e) => setAttest(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
          />
          <span>
            I confirm {fullName.trim() || "this person"} has agreed to let
            me manage their consultations on this account, or I hold legal
            authority to do so on their behalf.
          </span>
        </label>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
        >
          {submitting ? "Adding…" : "Add family member"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
