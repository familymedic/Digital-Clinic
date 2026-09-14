"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Admin system, step 2: doctor payouts. PKR 350 per completed,
// non-refunded consultation, generated as a deliberate monthly snapshot
// (not a live-recalculated number) so a payout, once generated, doesn't
// silently change if something happens to a consultation afterward.
// Actually paying a doctor is a real bank transfer the physician makes
// himself (Section 41 — the app can't move money) — "Mark as paid" just
// records that it happened.
//
// Period basis: a consultation's own booking date (created_at), not the
// date it was later completed — the simpler of two reasonable choices,
// stated here so it's an explicit, adjustable decision rather than a
// hidden one. Almost never differs in practice for same-day telemedicine
// visits.

const DOCTOR_PAYOUT_PKR = 350;

interface DoctorRow {
  id: string;
  full_name: string;
}

interface PayoutRow {
  id: string;
  doctor_id: string;
  period_start: string;
  period_end: string;
  consultation_count: number;
  amount: number;
  status: "pending" | "paid";
  paid_at: string | null;
  created_at: string;
}

function monthBounds(monthStr: string): { start: string; end: string } {
  // monthStr is "YYYY-MM" from an <input type="month">.
  const [y, m] = monthStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function AdminPayouts() {
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [doctorsRes, payoutsRes] = await Promise.all([
      supabase.from("doctor_profiles").select("id, full_name").order("full_name"),
      supabase.from("doctor_payouts").select("*").order("period_start", { ascending: false }),
    ]);
    if (doctorsRes.error) {
      setLoadError(doctorsRes.error.message);
    } else {
      setDoctors(doctorsRes.data as DoctorRow[]);
      if (!selectedDoctor && doctorsRes.data && doctorsRes.data.length > 0) {
        setSelectedDoctor(doctorsRes.data[0].id);
      }
    }
    if (payoutsRes.error) {
      setLoadError((prev) => prev ?? payoutsRes.error!.message);
    } else {
      setPayouts(payoutsRes.data as PayoutRow[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generatePayout() {
    if (!supabase || !selectedDoctor) return;
    setGenerating(true);
    setGenerateError(null);

    const { start, end } = monthBounds(month);

    const { data: consultations, error: consultError } = await supabase
      .from("consultations")
      .select("id")
      .eq("doctor_id", selectedDoctor)
      .eq("status", "completed")
      .gte("created_at", start)
      .lt("created_at", end);

    if (consultError) {
      setGenerating(false);
      setGenerateError(consultError.message);
      return;
    }

    const consultationIds = (consultations ?? []).map((c) => c.id as string);
    let payableCount = consultationIds.length;

    if (consultationIds.length > 0) {
      const { data: refunded, error: refundError } = await supabase
        .from("payments")
        .select("consultation_id")
        .in("consultation_id", consultationIds)
        .not("refunded_amount", "is", null);

      if (refundError) {
        setGenerating(false);
        setGenerateError(refundError.message);
        return;
      }
      // Any refund at all (partial or full) means the doctor earns
      // nothing for that visit — the physician's own explicit choice.
      payableCount -= new Set((refunded ?? []).map((r) => r.consultation_id)).size;
    }

    const amount = payableCount * DOCTOR_PAYOUT_PKR;

    const { error: upsertError } = await supabase.from("doctor_payouts").upsert(
      {
        doctor_id: selectedDoctor,
        period_start: start,
        period_end: end,
        consultation_count: payableCount,
        amount,
        status: "pending",
      },
      { onConflict: "doctor_id,period_start,period_end" }
    );

    setGenerating(false);
    if (upsertError) {
      setGenerateError(upsertError.message);
      return;
    }
    await load();
  }

  async function markPaid(id: string) {
    if (!supabase) return;
    setMarking(id);
    const { error } = await supabase
      .from("doctor_payouts")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id);
    setMarking(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  function doctorName(id: string): string {
    return doctors.find((d) => d.id === id)?.full_name ?? "Unknown doctor";
  }

  return (
    <AdminGuard title="Doctor payouts">
      {() => (
        <div>
          <PageHeader title="Doctor payouts" subtitle={`PKR ${DOCTOR_PAYOUT_PKR} per completed, non-refunded consultation.`} />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Generate a payout</h2>
              <p className="mt-1 text-xs text-slate-500">
                Counts this doctor&rsquo;s completed consultations booked in the chosen month, minus any that were
                later refunded. Re-generating the same doctor/month updates the existing snapshot.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
                <select
                  value={selectedDoctor}
                  onChange={(e) => setSelectedDoctor(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={generatePayout}
                  disabled={generating || !selectedDoctor}
                  className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {generating ? "Generating…" : "Generate"}
                </button>
              </div>
              {generateError && <p className="mt-2 text-sm text-red-700">{generateError}</p>}
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Payout history</h2>
              {loadError && <p className="mt-2 text-sm text-red-700">{loadError}</p>}
              {payouts === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : payouts.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No payouts generated yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {payouts.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{doctorName(p.doctor_id)}</div>
                        <div className="text-xs text-slate-500">
                          {p.period_start} – {p.period_end} · {p.consultation_count} consultation
                          {p.consultation_count === 1 ? "" : "s"} · PKR {p.amount.toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            p.status === "paid" ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {p.status === "paid" ? "Paid" : "Pending"}
                        </span>
                        {p.status === "pending" && (
                          <button
                            onClick={() => markPaid(p.id)}
                            disabled={marking === p.id}
                            className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
