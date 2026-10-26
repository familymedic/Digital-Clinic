"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Where a family lands after the Safepay checkout for a Family Pack
// (migrations 0088-0090). Safepay can take a minute to send its own
// confirmation, so instead of waiting for it we ask Safepay directly (via
// /api/packages/confirm) every few seconds. As soon as the payment is
// confirmed the family is sent to their dashboard. Nothing on this page is
// trusted as proof of payment - it only asks the server.

type Phase = "checking" | "paid" | "slow" | "cancelled" | "signedout";

const POLL_MS = 4000;
const MAX_TRIES = 15; // about a minute

export default function PackReturnPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const tries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  async function check() {
    if (!supabase || stopped.current) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setPhase("signedout");
      return;
    }
    tries.current += 1;
    let status = "pending";
    try {
      const res = await fetch("/api/packages/confirm", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json().catch(() => ({}))) as { status?: string };
      status = json.status ?? "pending";
    } catch {
      // network blip - try again on the next tick
    }
    if (stopped.current) return;
    if (status === "paid") {
      setPhase("paid");
      timer.current = setTimeout(() => router.replace("/dashboard"), 2500);
      return;
    }
    if (tries.current >= MAX_TRIES) {
      setPhase("slow");
      return;
    }
    timer.current = setTimeout(check, POLL_MS);
  }

  useEffect(() => {
    stopped.current = false;
    const cancelled = new URLSearchParams(window.location.search).get("outcome") === "cancelled";
    timer.current = setTimeout(() => {
      if (cancelled) setPhase("cancelled");
      else void check();
    }, 0);
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-ink-border bg-white p-6 text-center shadow-sm">
        {phase === "checking" && (
          <>
            <div className="text-base font-bold text-ink-900">Confirming your payment…</div>
            <p className="mt-2 text-sm text-ink-600">This usually takes a few seconds. Please don&rsquo;t close this page.</p>
          </>
        )}
        {phase === "paid" && (
          <>
            <div className="text-base font-bold text-teal-800">Payment received</div>
            <p className="mt-2 text-sm text-ink-600">Your Family Pack is ready. Taking you to your dashboard, where you can start a consultation with one tap…</p>
          </>
        )}
        {phase === "slow" && (
          <>
            <div className="text-base font-bold text-amber-900">Still waiting for Safepay&rsquo;s confirmation</div>
            <p className="mt-2 text-sm text-ink-600">
              If you completed the payment, your pack will appear on your dashboard automatically within a few minutes. Nothing more is needed from you. If it has not appeared after an hour, please contact us
              and we will sort it out.
            </p>
            <div className="mt-4 flex justify-center gap-4 text-sm font-semibold text-teal-700">
              <button
                onClick={() => {
                  tries.current = 0;
                  setPhase("checking");
                  void check();
                }}
                className="underline underline-offset-2"
              >
                Check again
              </button>
              <Link href="/dashboard" className="underline underline-offset-2">Go to dashboard</Link>
            </div>
          </>
        )}
        {phase === "cancelled" && (
          <>
            <div className="text-base font-bold text-ink-900">Payment cancelled</div>
            <p className="mt-2 text-sm text-ink-600">Nothing was charged. You can buy the pack whenever you&rsquo;re ready.</p>
            <Link href="/doctors" className="mt-4 inline-block text-sm font-semibold text-teal-700 underline underline-offset-2">Back to our doctors</Link>
          </>
        )}
        {phase === "signedout" && (
          <>
            <div className="text-base font-bold text-ink-900">Please log in</div>
            <p className="mt-2 text-sm text-ink-600">Log in to see your payment status.</p>
            <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-teal-700 underline underline-offset-2">Log in</Link>
          </>
        )}
      </div>
    </div>
  );
}
