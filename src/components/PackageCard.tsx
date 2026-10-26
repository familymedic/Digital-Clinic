"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { flushPackRef, modesText, pkr, type PackagePublic } from "@/lib/packages";

// The Family Pack offer on a doctor's public page (migrations 0088-0091).
// Shown only when the admin has opened sales AND this doctor has a live pack;
// otherwise the page that renders this component passes nothing and the card
// never appears. Buying is a normal Safepay checkout: the price and every rule
// are decided on the server, nothing here is trusted.

export default function PackageCard({ pack, doctorId, doctorName, refCode }: { pack: PackagePublic; doctorId: string; doctorName: string; refCode?: string | null }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isGuest = !!session && String((session.user.user_metadata as Record<string, unknown> | null)?.is_guest ?? "") === "true";
  const next = `/doctors/${doctorId}${refCode ? `?pack=${refCode}` : ""}`;
  const nextQ = encodeURIComponent(next);

  async function buy() {
    if (!supabase || !session) return;
    setBusy(true);
    setErr(null);
    try {
      // Make sure a doctor's link, if this family arrived through one, is on record first.
      await flushPackRef();
      const res = await fetch("/api/packages/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ packageId: pack.package_id }),
      });
      const json = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !json.checkoutUrl) {
        setErr(json.error ?? "Couldn't start the payment. Please try again.");
        setBusy(false);
        return;
      }
      window.location.href = json.checkoutUrl;
    } catch {
      setErr("Network problem - nothing was charged. Please try again.");
      setBusy(false);
    }
  }

  const modes = modesText(pack);

  return (
    <section id="family-pack" className="mt-8 rounded-[24px] border border-teal-200 bg-[#f1f9f6] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-teal-700">{pack.name}</h3>
          <div className="mt-1 text-3xl font-extrabold text-ink-900">{pkr(pack.price_pkr)}</div>
          <div className="text-sm text-ink-700">
            {pack.consultations_total} consultations with {doctorName} for up to {pack.members_allowed} people in your family, valid for {pack.validity_days} days.
          </div>
        </div>
        {pack.spots_left !== null && pack.spots_left <= 5 && !pack.full && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-800">
            {pack.spots_left} place{pack.spots_left === 1 ? "" : "s"} left
          </span>
        )}
      </div>

      <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
        <li>&#10003; {modes}.</li>
        <li>&#10003; Message the doctor whenever you need to. Replies come during the doctor&rsquo;s working hours; the doctor aims to reply within {pack.reply_window_hours} hours.</li>
        <li>&#10003; No booking each time: one tap to start a consultation from your dashboard.</li>
        <li>&#10003; You pay once. It does not renew by itself.</li>
        {pack.rollover_enabled && <li>&#10003; Renew within a week of it ending and unused consultations can carry over.</li>}
      </ul>
      <p className="mt-3 text-xs text-ink-500">Not for emergencies. In an emergency call 1122 or go to the nearest hospital.</p>

      <div className="mt-5">
        {pack.full ? (
          <p className="text-sm font-semibold text-amber-800">This pack is full right now. Please check again soon.</p>
        ) : !session ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/register?next=${nextQ}`} className="rounded-full bg-[#ffb454] px-5 py-3 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272]">
              Create a free account to buy
            </Link>
            <Link href={`/login?next=${nextQ}`} className="text-sm font-semibold text-teal-700 underline underline-offset-2">
              I already have an account
            </Link>
          </div>
        ) : isGuest ? (
          <Link href={`/register?next=${nextQ}`} className="inline-block rounded-full bg-[#ffb454] px-5 py-3 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272]">
            Create a free account to buy
          </Link>
        ) : (
          <button type="button" onClick={buy} disabled={busy} className="rounded-full bg-[#ffb454] px-6 py-3 text-sm font-extrabold text-[#3b2500] shadow-[0_8px_20px_-8px_rgba(255,180,84,0.8)] hover:bg-[#ffc272] disabled:opacity-60">
            {busy ? "Opening payment…" : `Buy this pack - ${pkr(pack.price_pkr)}`}
          </button>
        )}
        {err && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{err}</p>}
      </div>
    </section>
  );
}
