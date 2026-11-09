"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";

// Where Safepay sends the owner back after paying a listing fee. The page asks our server to
// check with Safepay directly (the webhook may arrive later), then shows the result.

type View = { kind: "checking" } | { kind: "paid"; name: string | null } | { kind: "pending"; name: string | null } | { kind: "cancelled" } | { kind: "error" };

export default function PaidReturn() {
  const params = useSearchParams();
  const tracker = params.get("tracker") ?? params.get("token") ?? "";
  const cancelled = params.get("outcome") === "cancelled";
  const [view, setView] = useState<View>({ kind: cancelled ? "cancelled" : tracker ? "checking" : "error" });
  const [link] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const t = window.localStorage.getItem("fm_locator_link");
      return t && /^[a-f0-9]{64}$/.test(t) ? `/locator/manage/${t}` : null;
    } catch {
      return null; // storage may be blocked
    }
  });

  useEffect(() => {
    if (cancelled || !tracker) return;
    let stop = false;
    let tries = 0;
    async function check() {
      tries += 1;
      try {
        const res = await fetch("/api/locator/pay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tracker }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; paid?: boolean; pending?: boolean; placeName?: string | null };
        if (stop) return;
        if (j.ok && j.paid) return setView({ kind: "paid", name: j.placeName ?? null });
        if (j.ok && j.pending && tries < 6) return void setTimeout(check, 3000);
        if (j.ok && j.pending) return setView({ kind: "pending", name: j.placeName ?? null });
        setView({ kind: "error" });
      } catch {
        if (!stop) setView({ kind: "error" });
      }
    }
    check();
    return () => {
      stop = true;
    };
  }, [tracker, cancelled]);

  const manage = link ? (
    <Link href={link} className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800">
      Open my listing page
    </Link>
  ) : (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">Use the private link we showed you when you applied to open your listing page.</p>
      <p className="text-xs text-ink-500">
        A Family Medic doctor?{" "}
        <Link href="/doctor/clinic" className="font-bold text-teal-700 underline">
          Go to My clinic in your dashboard
        </Link>
        .
      </p>
    </div>
  );

  return (
    <div>
      <PageHeader title="Locator listing payment" />
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <div className="rounded-3xl border border-[#d7e7e2] bg-white p-6 text-sm text-ink-700" data-testid="paid-result">
          {view.kind === "checking" && <p className="font-semibold">Checking your payment with Safepay…</p>}
          {view.kind === "paid" && (
            <>
              <p className="text-base font-extrabold text-ink-900">Payment received. Thank you!</p>
              <p className="mt-2">{view.name ? `${view.name} is now live` : "Your listing is now live"} on the Family Medic Locator for 12 months.</p>
              <div className="mt-4">{manage}</div>
            </>
          )}
          {view.kind === "pending" && (
            <>
              <p className="text-base font-extrabold text-ink-900">We are still waiting for the confirmation.</p>
              <p className="mt-2">If you completed the payment, your listing goes live automatically within a few minutes. Nothing more to do.</p>
              <div className="mt-4">{manage}</div>
            </>
          )}
          {view.kind === "cancelled" && (
            <>
              <p className="text-base font-extrabold text-ink-900">The payment was cancelled.</p>
              <p className="mt-2">No money was taken. You can pay any time from your listing page.</p>
              <div className="mt-4">{manage}</div>
            </>
          )}
          {view.kind === "error" && (
            <>
              <p className="text-base font-extrabold text-ink-900">We could not check this payment.</p>
              <p className="mt-2">If you were charged, do not pay again: your listing will switch on once Safepay confirms it, or contact us and we will sort it out.</p>
              <div className="mt-4">{manage}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
