"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// End-of-consultation wrap-up for the doctor (2026-10-11).
//
// Four endings:
//   1. Write prescription — hands over to the existing prescription form;
//      the consultation completes by itself when it is issued (0018).
//   2. Advice only        — closes the consultation with a written note
//      the patient sees on their dashboard (and by email).
//   3. Needs follow-up    — closes it, then takes the doctor to the
//      follow-up tools on the consultation page.
//   4. Patient didn't attend — closes it as a no-show; the patient is
//      emailed.
// Closing is done by the end_consultation() database function (0069),
// which only the consultation's own doctor can call.

type Choice = null | "advice_only" | "follow_up" | "patient_no_show";

const OUTCOME_LABEL: Record<string, string> = {
  prescription: "Prescription issued",
  advice_only: "Advice only",
  follow_up: "Needs follow-up",
  patient_no_show: "Patient didn't attend",
};

export default function EndConsultationPanel({
  consultationId,
  status,
  detailHref,
  onEnded,
  startOpen = false,
}: {
  consultationId: string;
  status: string;
  /** Page holding the prescription form and follow-up tools. */
  detailHref: string;
  onEnded?: () => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [choice, setChoice] = useState<Choice>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ outcome: string | null; outcome_note: string | null } | null>(null);

  // Fail-soft read of how a closed consultation ended (columns arrive
  // with migration 0069; if it is not applied this just shows nothing).
  useEffect(() => {
    const client = supabase;
    if (!client || status !== "completed") return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await client
          .from("consultations")
          .select("outcome, outcome_note")
          .eq("id", consultationId)
          .maybeSingle();
        if (!cancelled && !e && data) setSaved(data as { outcome: string | null; outcome_note: string | null });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [consultationId, status]);

  async function submit() {
    if (!supabase || !choice) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("end_consultation", {
        p_consultation_id: consultationId,
        p_outcome: choice,
        p_note: note.trim() || null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setDoneMessage(
        choice === "advice_only"
          ? "Closed. Your advice is now on the patient's dashboard and has been emailed to them."
          : choice === "follow_up"
            ? "Closed. Use the follow-up tools on the consultation page to grant a free follow-up or note the plan."
            : "Closed as a no-show. The patient has been emailed."
      );
      onEnded?.();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const card = "rounded-[24px] bg-white p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-6";

  if (doneMessage) {
    return (
      <section className={card}>
        <p className="text-sm font-semibold text-emerald-800">{doneMessage}</p>
        {choice === "follow_up" && (
          <Link
            href={`${detailHref}#followup`}
            className="mt-3 inline-block rounded-full bg-[#0a3733] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Plan the follow-up →
          </Link>
        )}
      </section>
    );
  }

  if (status === "completed") {
    if (saved?.outcome) {
      return (
        <section className={card}>
          <div className="text-xs font-extrabold uppercase tracking-wider text-teal-700">How this ended</div>
          <p className="mt-1 text-base font-extrabold text-ink-900">{OUTCOME_LABEL[saved.outcome] ?? saved.outcome}</p>
          {saved.outcome_note && <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{saved.outcome_note}</p>}
        </section>
      );
    }
    return null;
  }

  if (status !== "submitted") return null;

  const optionBase =
    "w-full rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-500";

  return (
    <section className={card}>
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-ink-900">Finished with this patient?</div>
            <div className="text-xs text-ink-500">Close the consultation and tell us how it ended.</div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-full bg-[#0a3733] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0f4a45]"
          >
            End consultation
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-extrabold text-ink-900">How did this consultation end?</div>
              <div className="text-xs text-ink-500">Pick one. Nothing is sent until you confirm.</div>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                setChoice(null);
                setError(null);
              }}
              className="text-xs font-semibold text-ink-500 hover:text-teal-700"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <Link
              href={detailHref}
              className={`${optionBase} border-[#d7e7e2] hover:border-teal-500`}
            >
              <div className="text-sm font-extrabold text-ink-900">Write prescription</div>
              <div className="mt-0.5 text-xs text-ink-500">
                Open the prescription form. The consultation closes by itself when you issue it.
              </div>
            </Link>

            <button
              type="button"
              onClick={() => setChoice(choice === "advice_only" ? null : "advice_only")}
              className={`${optionBase} ${choice === "advice_only" ? "border-teal-600 bg-teal-50" : "border-[#d7e7e2] hover:border-teal-500"}`}
            >
              <div className="text-sm font-extrabold text-ink-900">Advice only</div>
              <div className="mt-0.5 text-xs text-ink-500">No medicine needed — leave written advice for the patient.</div>
            </button>

            <button
              type="button"
              onClick={() => setChoice(choice === "follow_up" ? null : "follow_up")}
              className={`${optionBase} ${choice === "follow_up" ? "border-teal-600 bg-teal-50" : "border-[#d7e7e2] hover:border-teal-500"}`}
            >
              <div className="text-sm font-extrabold text-ink-900">Needs follow-up</div>
              <div className="mt-0.5 text-xs text-ink-500">Close this visit and plan the next one (free follow-up or a note).</div>
            </button>

            <button
              type="button"
              onClick={() => setChoice(choice === "patient_no_show" ? null : "patient_no_show")}
              className={`${optionBase} ${choice === "patient_no_show" ? "border-amber-500 bg-amber-50" : "border-[#d7e7e2] hover:border-amber-400"}`}
            >
              <div className="text-sm font-extrabold text-ink-900">Patient didn&rsquo;t attend</div>
              <div className="mt-0.5 text-xs text-ink-500">The patient never joined. The visit is closed and they are emailed.</div>
            </button>
          </div>

          {choice === "advice_only" && (
            <div className="mt-4">
              <label className="text-xs font-bold text-ink-700" htmlFor="end-advice">
                Advice for the patient (required)
              </label>
              <textarea
                id="end-advice"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-[#d7e7e2] p-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="e.g. Rest, plenty of fluids. Come back if the fever lasts more than 3 days."
              />
            </div>
          )}
          {choice === "follow_up" && (
            <div className="mt-4">
              <label className="text-xs font-bold text-ink-700" htmlFor="end-followup">
                Note (optional)
              </label>
              <textarea
                id="end-followup"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-[#d7e7e2] p-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="e.g. Review blood pressure readings in 2 weeks."
              />
            </div>
          )}
          {choice === "patient_no_show" && (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              Only choose this if the patient did not join at all. This closes the consultation. Any refund stays an
              admin decision.
            </p>
          )}

          {error && <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>}

          {choice && (
            <button
              onClick={submit}
              disabled={busy || (choice === "advice_only" && note.trim() === "")}
              className="mt-4 rounded-full bg-[#ffb454] px-6 py-2.5 text-sm font-extrabold text-[#3b2500] shadow-[0_8px_20px_-10px_rgba(255,180,84,0.9)] transition hover:bg-[#ffc272] disabled:opacity-50"
            >
              {busy
                ? "Closing…"
                : choice === "advice_only"
                  ? "Send advice & close"
                  : choice === "follow_up"
                    ? "Close & plan follow-up"
                    : "Confirm — patient didn't attend"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
