"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";

// Doctor onboarding, step 4: admin visibility into the PKR 5,000/month
// platform subscription — built now, deliberately not enforced anywhere
// yet (see 0030's migration comment and the payments webhook route for
// the full reasoning). This page has two jobs: show each approved
// doctor's subscription status (as the webhook has recorded it), and
// give admin a manual override for when automatic email-matching
// couldn't find a doctor — the fallback this project's own research
// found is genuinely necessary, not just a nice-to-have (Safepay's
// subscription webhooks carry no merchant-supplied identifier, only the
// subscriber's email).

type SubStatus = "unpaid" | "active" | "past_due" | "canceled";

interface DoctorRow {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  subscription_status: SubStatus;
  safepay_subscription_id: string | null;
  subscription_current_period_end: string | null;
  subscription_last_event_at: string | null;
}

interface UnmatchedEvent {
  id: string;
  event_type: string;
  customer_email: string | null;
  safepay_subscription_id: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<SubStatus, string> = {
  active: "bg-teal-100 text-teal-800",
  unpaid: "bg-slate-200 text-slate-600",
  past_due: "bg-amber-100 text-amber-800",
  canceled: "bg-red-100 text-red-800",
};

export default function AdminSubscriptions() {
  const [rows, setRows] = useState<DoctorRow[] | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [doctorsRes, eventsRes] = await Promise.all([
      supabase
        .from("doctor_profiles")
        .select(
          "id, full_name, email, is_active, subscription_status, safepay_subscription_id, subscription_current_period_end, subscription_last_event_at"
        )
        .eq("verification_status", "approved")
        .order("full_name"),
      supabase
        .from("doctor_subscription_events")
        .select("id, event_type, customer_email, safepay_subscription_id, created_at")
        .eq("matched", false)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (doctorsRes.error) {
      setLoadError(doctorsRes.error.message);
    } else {
      setRows(doctorsRes.data as DoctorRow[]);
    }
    if (!eventsRes.error) {
      setUnmatched(eventsRes.data as UnmatchedEvent[]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Manual override: for when the webhook couldn't match a doctor by
  // email (wrong email used at Safepay checkout, event arrived before
  // the doctor even registered here, etc.) — cross-reference the
  // unmatched event list above or Safepay's own dashboard (its
  // per-subscription "User Details" panel shows the subscriber's email)
  // and mark it here. A future webhook for the SAME subscription id, if
  // one arrives, will simply update this same row going forward once
  // safepay_subscription_id is set — but this manual click never
  // requires one to have happened yet.
  async function markPaid(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        subscription_status: "active",
        subscription_current_period_end: periodEnd.toISOString(),
        subscription_last_event_at: new Date().toISOString(),
      })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function markUnpaid(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase
      .from("doctor_profiles")
      .update({ subscription_status: "canceled" })
      .eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  return (
    <AdminGuard title="Doctor subscriptions">
      {() => (
        <div>
          <PageHeader
            title="Doctor subscriptions"
            subtitle="PKR 5,000/month platform fee. Status updates automatically once a doctor subscribes via Safepay using their account email — this page also lets you correct it by hand."
          />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Doctors</h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No approved doctors yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rows.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{d.full_name}</div>
                        <div className="text-xs text-slate-500">
                          {d.email ?? "no email on file"}
                          {d.subscription_current_period_end && (
                            <>
                              {" "}
                              · renews {new Date(d.subscription_current_period_end).toLocaleDateString()}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[d.subscription_status]}`}
                        >
                          {d.subscription_status}
                        </span>
                        {d.subscription_status !== "active" && (
                          <button
                            onClick={() => markPaid(d.id)}
                            disabled={updating === d.id}
                            className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                        )}
                        {d.subscription_status === "active" && (
                          <button
                            onClick={() => markUnpaid(d.id)}
                            disabled={updating === d.id}
                            className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Mark canceled
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {unmatched !== null && unmatched.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Unmatched subscription events ({unmatched.length})
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  A Safepay subscription event arrived whose email didn&rsquo;t match any doctor on file. Find the
                  right doctor above (check Safepay&rsquo;s own dashboard for the subscriber&rsquo;s details if
                  needed) and use &ldquo;Mark paid&rdquo;.
                </p>
                <ul className="mt-3 space-y-2">
                  {unmatched.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
                    >
                      <span className="font-medium">{e.event_type}</span> — {e.customer_email ?? "no email in payload"}
                      {" · "}
                      {new Date(e.created_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
