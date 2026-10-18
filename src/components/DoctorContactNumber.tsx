"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { normalizePhone, formatPhone } from "@/lib/phone";

// The doctor's own private mobile number (0079). Only the Family Medic team can
// see it (for clinic messages); patients never do. Fail-soft: if the 0079 script
// has not been run yet, the card still shows and the save just reports a problem.
export default function DoctorContactNumber({ userId }: { userId: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("doctor_profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return;
        const p = !e && data && typeof (data as { phone?: unknown }).phone === "string" ? (data as { phone: string }).phone : null;
        setSaved(p);
        if (p) setPhone(formatPhone(p));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setOk(false);
    const parsed = normalizePhone(phone);
    if (!parsed) {
      setError("Please enter a valid mobile number, for example 0300 1234567.");
      return;
    }
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const result = await apiFetch("/api/doctors/contact", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't save your number.");
        return;
      }
      setSaved(parsed.norm);
      setPhone(parsed.display);
      setOk(true);
    } catch {
      setError("Something went wrong. Please try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 rounded-2xl border border-[#dcebe6] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]"
    >
      <label htmlFor="doctorContactPhone" className="block text-sm font-semibold text-ink-900">
        My mobile number
      </label>
      <p className="mt-1 text-xs text-ink-500">
        Private: only the Family Medic team can see it, never patients. We use it to reach you.
        {loaded && !saved && <span className="font-semibold text-amber-800"> You haven&rsquo;t added one yet.</span>}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          id="doctorContactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setOk(false);
          }}
          placeholder="e.g. 0300 1234567"
          className="min-w-0 flex-1 rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      {ok && <p className="mt-2 text-xs font-medium text-teal-700">Saved.</p>}
    </form>
  );
}
