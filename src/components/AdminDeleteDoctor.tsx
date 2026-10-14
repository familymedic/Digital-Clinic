"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/monitoredFetch";

// "Delete" for one doctor entry on Admin -> Doctors. Two steps (Delete, then
// Yes delete) so it can't be tapped by accident. The server refuses a doctor
// who has consultations, payouts, feedback or a paid subscription, and says
// so in plain words — for those, Deactivate is the right tool.

export default function AdminDeleteDoctor({
  id,
  name,
  onDeleted,
}: {
  id: string;
  name: string;
  onDeleted: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { res, data } = await safeJson(`/api/admin/doctors/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't delete this doctor.");
      setConfirming(false);
      return;
    }
    const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
    onDeleted(`Deleted ${name}.${warnings.length ? " " + warnings.join(" ") : ""}`);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs text-red-700">Delete {name} for good?</span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-xs font-medium text-ink-500 underline underline-offset-2"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="text-xs font-medium text-red-700 underline underline-offset-2"
        >
          Delete
        </button>
      )}
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </span>
  );
}
