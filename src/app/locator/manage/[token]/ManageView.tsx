"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PosterMaker from "@/components/locator/PosterMaker";
import { kindLabel } from "@/lib/locator";

// The owner's private page (no account: the long link is the key). Shows where the listing is
// (applied, documents checked, paid, live) and lets them pay or renew. It deliberately shows no
// view or tap numbers: statistics are for the admin only. The poster maker is here so a new owner
// can share the listing at once.

interface Place {
  id: string;
  name: string;
  kind: string;
  area: string;
  status: string;
  verification_status: string;
  rejection_reason: string | null;
  paid_until: string | null;
  fee_pkr: number;
  requires_verification: boolean;
  live: boolean;
  phone_verified: boolean;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function ManageView({ token }: { token: string }) {
  const [place, setPlace] = useState<Place | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/locator/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; place?: Place };
        if (cancelled) return;
        if (res.status === 404) return setState("missing");
        if (j.ok && j.place) {
          setPlace({ ...j.place, fee_pkr: Number(j.place.fee_pkr) });
          setState("ready");
        } else setState("error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function pay() {
    setPaying(true);
    setPayMsg("");
    try {
      const res = await fetch("/api/locator/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; error?: string };
      if (j.ok && j.checkoutUrl) {
        window.location.href = j.checkoutUrl;
        return;
      }
      setPayMsg(
        j.error === "payments_unavailable"
          ? "Online payment is not available right now. Please contact us and we will take payment another way."
          : j.error === "needs_verification"
            ? "Payment opens after our team has checked your documents."
            : "Could not start the payment. Please try again in a minute."
      );
    } catch {
      setPayMsg("Could not start the payment. Please try again in a minute.");
    }
    setPaying(false);
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader title="Your Locator listing" />
        <p className="mx-auto max-w-xl px-4 py-10 text-sm text-ink-500">Loading…</p>
      </div>
    );
  }
  if (state === "missing" || state === "error" || !place) {
    return (
      <div>
        <PageHeader title="Your Locator listing" />
        <div className="mx-auto max-w-xl px-4 py-10 text-sm text-ink-700">
          <p className="rounded-3xl border border-[#d7e7e2] bg-white p-6">
            {state === "missing"
              ? "We could not find a listing for this link. Please check that you copied the whole link, or contact us."
              : "Something went wrong. Please try again in a moment."}
          </p>
          <Link href="/locator" className="mt-4 inline-block font-bold text-teal-700 underline">
            Go to the locator
          </Link>
        </div>
      </div>
    );
  }

  const verified = place.verification_status === "verified";
  const rejected = place.verification_status === "rejected";
  const awaitingCheck = place.requires_verification && place.verification_status === "pending";
  const paidActive = Boolean(place.paid_until && new Date(place.paid_until) > new Date());
  const canPay = !rejected && (!place.requires_verification || verified) && place.status !== "hidden";
  const steps: { label: string; ok: boolean }[] = [
    { label: "Applied", ok: true },
    ...(place.requires_verification ? [{ label: "Documents checked", ok: verified }] : []),
    { label: "Fee paid", ok: paidActive },
    { label: "Live on the locator", ok: place.live },
  ];

  return (
    <div>
      <PageHeader title={place.name} subtitle={`${kindLabel(place.kind)} · ${place.area}`} />
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-10 sm:px-6">
        <section className="rounded-3xl border border-[#d7e7e2] bg-white p-5 sm:p-6" aria-label="Status">
          <ol className="grid gap-2 sm:grid-cols-4">
            {steps.map((st) => (
              <li
                key={st.label}
                className={`rounded-2xl px-3 py-3 text-center text-xs font-extrabold ${st.ok ? "bg-teal-50 text-teal-800" : "bg-[#eef3f1] text-ink-500"}`}
              >
                {st.ok ? "✓ " : "○ "}
                {st.label}
              </li>
            ))}
          </ol>

          <div className="mt-4 text-sm text-ink-700" data-testid="manage-status">
            {rejected && (
              <p className="rounded-2xl bg-red-50 p-3 font-semibold text-red-800">
                We could not approve this listing{place.rejection_reason ? `: ${place.rejection_reason}` : "."} Please contact us with the corrected documents.
              </p>
            )}
            {awaitingCheck && <p>Our team is checking your documents and pin. This usually takes 1 to 3 working days. The Pay button opens once they are approved.</p>}
            {!rejected && !awaitingCheck && !paidActive && <p>Approved. Pay the annual fee to go live on the locator.</p>}
            {paidActive && place.paid_until && (
              <p>
                {place.live ? "You are live on the locator" : "Your fee is paid"} until <strong>{fmtDate(place.paid_until)}</strong>.
              </p>
            )}
          </div>

          {canPay && (
            <div className="mt-4">
              <button
                onClick={pay}
                disabled={paying}
                data-testid="manage-pay"
                className="min-h-11 rounded-full bg-[#ffb454] px-6 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272] disabled:opacity-60"
              >
                {paying ? "Opening payment…" : paidActive ? `Renew for 12 months · PKR ${place.fee_pkr.toLocaleString("en-PK")}` : `Pay PKR ${place.fee_pkr.toLocaleString("en-PK")} for 12 months`}
              </button>
              {payMsg && <p className="mt-2 text-sm font-semibold text-amber-800">{payMsg}</p>}
            </div>
          )}
          {!place.phone_verified && <p className="mt-3 text-xs text-ink-500">We will call the mobile number you gave to confirm it.</p>}
        </section>

        <section className="rounded-3xl border border-[#d7e7e2] bg-white p-5 sm:p-6" aria-label="Share">
          <h2 className="text-xs font-extrabold tracking-[0.18em] text-teal-700">YOUR POSTER</h2>
          <p className="mb-3 mt-2 text-sm text-ink-700">Tell your patients you are on the locator. They scan the code and find you.</p>
          <PosterMaker name={place.name} kindLabel={kindLabel(place.kind)} area={place.area} verified={verified} />
        </section>
      </div>
    </div>
  );
}
