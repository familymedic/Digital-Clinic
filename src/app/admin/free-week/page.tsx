"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { fmtDay } from "@/lib/freeWeek";

// Admin control + report for the free consultation week (migration 0081).
// One campaign. The "Switch on" box is the master switch: off means nothing
// new can be claimed, doctors/pages stop showing it;
// visits already booked still go ahead.

interface Campaign {
  exists: boolean;
  phase?: string;
  name?: string;
  opens_on?: string;
  starts_on?: string;
  ends_on?: string;
  active?: boolean;
  credits_per_account?: number;
  overall_cap?: number | null;
}
interface DoctorRow {
  doctor_id: string;
  full_name: string;
  opted_in: boolean;
  daily_free_cap: number;
  visits: number;
  completed: number;
  free_slots: number;
  avg_rating?: number | null;
  review_count?: number | null;
}
interface Report {
  exists: boolean;
  phase?: string;
  families_registered?: number;
  families_consenting?: number;
  families_booked?: number;
  visits_booked?: number;
  visits_completed?: number;
  visits_cancelled?: number;
  visits_text?: number;
  visits_audio?: number;
  doctors_opted_in?: number;
  families_completed_free?: number;
  families_paid_after?: number;
  paid_revenue_pkr?: number;
  doctors?: DoctorRow[];
}
interface Family {
  full_name: string;
  email: string;
  mobile: string;
  marketing_consent: boolean;
  registered_at: string;
  free_visits: number;
  completed: number;
}

const CARD = "rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]";
const PHASE_LABEL: Record<string, string> = {
  none: "Switched off",
  draft: "On - waiting for the registration date",
  preregister: "On - families can register, free visits not open yet",
  open: "OPEN - free visits are live",
  ended: "Ended",
};

function Num({ label, value, hint }: { label: string; value: number | string | undefined; hint?: string }) {
  return (
    <div className="rounded-2xl bg-[#f5faf8] p-4">
      <div className="text-2xl font-extrabold text-ink-900">{value ?? "-"}</div>
      <div className="text-xs font-semibold text-ink-700">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

function Inner() {
  const [c, setC] = useState<Campaign | null>(null);
  const [rep, setRep] = useState<Report | null>(null);
  const [fam, setFam] = useState<Family[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [name, setName] = useState("Free Family Consultation Week");
  const [opens, setOpens] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [active, setActive] = useState(false);
  const [credits, setCredits] = useState("3");
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setErr(null);
    const g = await supabase.rpc("admin_free_week_get");
    if (g.error) {
      setErr(
        /function .*does not exist|Could not find the function/i.test(g.error.message)
          ? "The free week database update (migration 0081) has not been run yet."
          : g.error.message
      );
      return;
    }
    const camp = g.data as Campaign;
    setC(camp);
    if (camp.exists) {
      setName(camp.name ?? name);
      setOpens(camp.opens_on ?? "");
      setStarts(camp.starts_on ?? "");
      setEnds(camp.ends_on ?? "");
      setActive(!!camp.active);
      setCredits(String(camp.credits_per_account ?? 3));
      setCap(camp.overall_cap == null ? "" : String(camp.overall_cap));
      const r = await supabase.rpc("admin_free_week_report");
      if (!r.error) setRep(r.data as Report);
      const f = await supabase.rpc("admin_free_week_families");
      if (!f.error) setFam((f.data ?? []) as Family[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  async function save() {
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    const { error } = await supabase.rpc("admin_free_week_save", {
      p_name: name,
      p_opens_on: opens,
      p_starts_on: starts,
      p_ends_on: ends,
      p_active: active,
      p_credits: Number(credits) || 3,
      p_overall_cap: cap.trim() ? Number(cap) : null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setSaved("Saved.");
      await load();
    }
  }

  function downloadConsenting() {
    const rows = fam.filter((f) => f.marketing_consent);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ["name,email,mobile,free_visits,completed", ...rows.map((f) => [f.full_name, f.email, f.mobile, String(f.free_visits), String(f.completed)].map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "free-week-families-who-agreed-to-messages.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const input = "mt-1 block w-full rounded-md border border-[#d7e7e2] px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      {err && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div>}

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-ink-900">Campaign settings</h2>
          {c?.exists && (
            <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${c.phase === "open" ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>
              {PHASE_LABEL[c.phase ?? "none"] ?? c.phase}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-500">Dates are Pakistan dates. Families register from the first date; free visits run from the second to the third.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-ink-700 sm:col-span-2">Name<input value={name} onChange={(e) => setName(e.target.value)} className={input} /></label>
          <label className="block text-xs font-semibold text-ink-700">Registration opens<input type="date" value={opens} onChange={(e) => setOpens(e.target.value)} className={input} /></label>
          <label className="block text-xs font-semibold text-ink-700">First free day<input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} className={input} /></label>
          <label className="block text-xs font-semibold text-ink-700">Last free day<input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className={input} /></label>
          <label className="block text-xs font-semibold text-ink-700">Free consultations per family<input type="number" min={1} max={10} value={credits} onChange={(e) => setCredits(e.target.value)} className={input} /></label>
          <label className="block text-xs font-semibold text-ink-700">Overall limit (optional)<input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="no limit" className={input} /></label>
        </div>
        <label className="mt-5 flex items-center gap-2.5 text-sm font-bold text-ink-900">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 rounded border-[#d7e7e2] text-teal-700" />
          Switch the free week ON (untick to switch everything off)
        </label>
        <div className="mt-4 flex items-center gap-4">
          <button type="button" disabled={busy || !opens || !starts || !ends} onClick={save} className="rounded-full bg-teal-700 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:bg-[#b9d3cd]">
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm font-semibold text-teal-700">{saved}</span>}
        </div>
      </div>

      {rep?.exists && (
        <>
          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Results so far</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Families registered" value={rep.families_registered} hint={`${rep.families_consenting ?? 0} agreed to offer messages`} />
              <Num label="Families who booked" value={rep.families_booked} />
              <Num label="Free visits booked" value={rep.visits_booked} hint={`${rep.visits_text ?? 0} text, ${rep.visits_audio ?? 0} audio`} />
              <Num label="Free visits completed" value={rep.visits_completed} hint={`${rep.visits_cancelled ?? 0} cancelled`} />
              <Num label="Doctors taking part" value={rep.doctors_opted_in} />
              <Num label="Families with a completed visit" value={rep.families_completed_free} />
              <Num label="…who then paid for a visit" value={rep.families_paid_after} hint="since the first free day" />
              <Num label="Paid revenue from registered families" value={`PKR ${Number(rep.paid_revenue_pkr ?? 0).toLocaleString()}`} />
            </div>
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Doctors</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">Doctor</th><th>Taking part</th><th>Daily limit</th><th>Free times</th><th>Visits</th><th>Completed</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  {(rep.doctors ?? []).map((d) => (
                    <tr key={d.doctor_id} className="border-t border-[#e6efec]">
                      <td className="py-2 font-semibold text-ink-900">{d.full_name}</td>
                      <td>{d.opted_in ? "Yes" : "Withdrawn"}</td>
                      <td>{d.daily_free_cap}</td>
                      <td>{d.free_slots}</td>
                      <td>{d.visits}</td>
                      <td>{d.completed}</td>
                      <td>{d.avg_rating != null ? `${Number(d.avg_rating).toFixed(1)} (${d.review_count})` : "-"}</td>
                    </tr>
                  ))}
                  {(rep.doctors ?? []).length === 0 && <tr><td colSpan={7} className="py-3 text-ink-500">No doctor has joined yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-ink-900">Registered families ({fam.length})</h2>
              <button type="button" onClick={downloadConsenting} disabled={!fam.some((f) => f.marketing_consent)} className="rounded-full border border-teal-600 px-4 py-2 text-xs font-extrabold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                Download those who agreed to messages (CSV)
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-500">Only message the families who ticked the offers box. Mobile numbers are private - please do not share this list.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">Name</th><th>Mobile</th><th>Offers OK</th><th>Registered</th><th>Free visits</th><th>Completed</th></tr>
                </thead>
                <tbody>
                  {fam.slice(0, 200).map((f, i) => (
                    <tr key={i} className="border-t border-[#e6efec]">
                      <td className="py-2 font-semibold text-ink-900">{f.full_name || f.email}</td>
                      <td>{f.mobile}</td>
                      <td>{f.marketing_consent ? "Yes" : "No"}</td>
                      <td>{fmtDay(f.registered_at.slice(0, 10))}</td>
                      <td>{f.free_visits}</td>
                      <td>{f.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fam.length > 200 && <p className="mt-2 text-xs text-ink-500">Showing the latest 200; the CSV has everyone who agreed.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminFreeWeek() {
  return (
    <AdminGuard title="Free Week">
      {() => (
        <div>
          <PageHeader title="Free Week" subtitle="Switch the free consultation week on or off, and see how it is going." />
          <Inner />
        </div>
      )}
    </AdminGuard>
  );
}
