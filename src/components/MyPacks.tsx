"use client";

import { useEffect } from "react";
import Link from "next/link";
import { daysLeft, fmtDate, flushPackRef, modesText, useMyPacks, type MyPack } from "@/lib/packages";

// "Your Family Pack" card on the patient dashboard (migrations 0088-0091).
// Renders nothing at all unless this account holds (or recently held) a pack,
// so the dashboard is unchanged for everyone else.

function consultationHref(c: MyPack["consultations"][number]): string {
  return c.mode === "text" ? `/consultation/${c.consultation_id}/messages` : `/consultation/${c.consultation_id}/call`;
}

export default function MyPacks() {
  const { packs } = useMyPacks();
  // A doctor's pack link, if this family arrived through one, is recorded here too.
  useEffect(() => {
    void flushPackRef();
  }, []);
  if (!packs || packs.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      {packs.map((p) => {
        const days = daysLeft(p.expires_at);
        const total = p.consultations_total + p.rollover_credits;
        const renewSoon = p.is_live && days <= 7;
        return (
          <section key={p.id} className="rounded-3xl border border-teal-200 bg-[#f1f9f6] p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-teal-700">Your Family Pack</h2>
                <div className="mt-1 text-lg font-extrabold text-ink-900">{p.doctor.name}</div>
                <div className="text-xs text-ink-500">{modesText(p)}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-ink-900">
                  {p.is_live ? p.credits_left : 0}
                  <span className="text-sm font-semibold text-ink-500"> of {total} left</span>
                </div>
                <div className="text-xs text-ink-500">{p.is_live ? `Ends ${fmtDate(p.expires_at)} (${days} day${days === 1 ? "" : "s"})` : `Ended ${fmtDate(p.expires_at)}`}</div>
              </div>
            </div>

            {p.members_used.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-ink-700">Used by:</span>
                {p.members_used.map((m) => (
                  <span key={m.id} className="rounded-full bg-white px-2.5 py-1 font-semibold text-teal-900">{m.name}</span>
                ))}
                <span className="text-ink-500">({p.members_used.length} of {p.members_allowed} places)</span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {p.is_live && p.credits_left > 0 && p.doctor.available && (
                <Link href={`/pack/${p.id}`} className="rounded-full bg-[#ffb454] px-5 py-2.5 text-sm font-extrabold text-[#3b2500] shadow-[0_8px_20px_-10px_rgba(255,180,84,0.9)] hover:bg-[#ffc272]">
                  Start a consultation
                </Link>
              )}
              {p.is_live && p.credits_left === 0 && <span className="text-sm font-semibold text-ink-700">All consultations used.</span>}
              {(renewSoon || !p.is_live || p.credits_left === 0) && (
                <Link href={`/doctors/${p.doctor.id}#family-pack`} className="text-sm font-semibold text-teal-700 underline underline-offset-2">
                  {p.is_live ? "Renew" : "Buy again"}
                </Link>
              )}
            </div>
            {renewSoon && p.credits_left > 0 && (
              <p className="mt-2 text-xs text-ink-500">Renew before it ends and unused consultations may carry over, if this pack allows it.</p>
            )}

            {p.consultations.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-teal-100 pt-3 text-sm">
                {p.consultations.slice(0, 3).map((c) => (
                  <li key={c.consultation_id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink-700">
                      {c.member} · {c.mode === "text" ? "Text" : c.mode === "audio" ? "Audio call" : "Video call"} · {fmtDate(c.created_at)}
                    </span>
                    <Link href={consultationHref(c)} className="text-xs font-semibold text-teal-700 underline underline-offset-2">
                      {c.mode === "text" ? "Open chat" : "Open"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-ink-500">Not for emergencies. In an emergency call 1122 or go to the nearest hospital.</p>
          </section>
        );
      })}
    </div>
  );
}
