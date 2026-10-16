"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/monitoredFetch";
import { QUICK_BOOKING_ENABLED, GUEST_ACCESS_DAYS } from "@/lib/quickBooking";

interface LinkInfo {
  url: string;
  accessUntil: string | null;
  pinSet: boolean;
  phoneNorm: string;
  phoneDisplay: string;
  doctorName: string | null;
  when: string | null;
}

// Shown right after a quick-booking guest has paid. Three jobs:
//   1. a saved link to this appointment, with a one-tap "send it to myself"
//      (the phone's own share menu - no messaging service involved, no cost);
//   2. a PIN the patient chooses, so they can get back with just their mobile
//      number if they lose the link;
//   3. plain words on how to come back and how long access lasts.
// Renders nothing for anyone who is not a quick-booking guest, and nothing at
// all while quick booking is switched off.
export default function GuestAccessPanel({ consultationId }: { consultationId?: string }) {
  const { session } = useAuth();
  const isGuest = QUICK_BOOKING_ENABLED && session?.user.user_metadata?.is_guest === true;
  const userId = session?.user.id;

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!isGuest || !supabase || !userId) return;
    const client = supabase;
    let cancelled = false;
    (async () => {
      const {
        data: { session: s },
      } = await client.auth.getSession();
      if (!s) return;
      // On the dashboard no consultation is passed: use the guest's latest one.
      let cid = consultationId;
      if (!cid) {
        const { data: latest } = await client
          .from("consultations")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(1);
        cid = (latest as { id: string }[] | null)?.[0]?.id;
        if (!cid) {
          if (!cancelled) setFailed(true);
          return;
        }
      }
      const result = await apiFetch<LinkInfo & { error?: string }>("/api/access/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ consultationId: cid }),
      });
      if (cancelled) return;
      if (!result.ok || !result.data?.url) {
        setFailed(true);
        return;
      }
      setInfo(result.data);
      setPinSaved(result.data.pinSet);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest, userId, consultationId]);

  if (!isGuest || failed) return null;

  if (!info) {
    return (
      <div className="mt-6 rounded-lg border border-[#d7e7e2] bg-white p-4 text-sm text-ink-500">
        Preparing your appointment link&hellip;
      </div>
    );
  }

  const whenText = info.when
    ? new Date(info.when).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const untilText = info.accessUntil
    ? new Date(info.accessUntil).toLocaleDateString(undefined, { day: "numeric", month: "long" })
    : null;

  const message =
    `Family Medic appointment${info.doctorName ? ` with ${info.doctorName}` : ""}${whenText ? ` on ${whenText}` : ""}.\n` +
    `Open your appointment: ${info.url}\n` +
    `Lost the link? Go to thefamilymedic.com/find-appointment and enter your mobile number (${info.phoneDisplay}) and your PIN.`;

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function shareToSelf() {
    try {
      await navigator.share({ title: "My Family Medic appointment", text: message });
    } catch {
      /* the patient closed the share menu - nothing to do */
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(info!.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the link is also shown below, to select by hand */
    }
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setPinError("Please choose a PIN of 4 to 6 digits (numbers only).");
      return;
    }
    if (!supabase) return;
    setSavingPin(true);
    const {
      data: { session: s },
    } = await supabase.auth.getSession();
    const result = await apiFetch<{ error?: string }>("/api/access/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s?.access_token ?? ""}` },
      body: JSON.stringify({ pin }),
    });
    setSavingPin(false);
    if (!result.ok) {
      setPinError(result.error ?? result.data?.error ?? "Couldn't save your PIN. Please try again.");
      return;
    }
    setPin("");
    setPinSaved(true);
    setChanging(false);
  }

  const pinForm = (
    <form onSubmit={savePin} noValidate className="mt-2 space-y-2">
      <div className="flex items-start gap-2">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label="Choose a PIN (4 to 6 digits)"
          placeholder="4 to 6 digits"
          className="w-40 rounded-md border border-[#d7e7e2] px-3 py-2 text-sm text-ink-900 shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
        />
        <button
          type="submit"
          disabled={savingPin}
          className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
        >
          {savingPin ? "Saving…" : "Save PIN"}
        </button>
        {changing && (
          <button
            type="button"
            onClick={() => {
              setChanging(false);
              setPin("");
              setPinError(null);
            }}
            className="px-2 py-2 text-sm font-medium text-ink-500 underline underline-offset-2"
          >
            Cancel
          </button>
        )}
      </div>
      {pinError && <p className="text-xs font-medium text-red-600">{pinError}</p>}
    </form>
  );

  return (
    <section
      aria-label="Save your appointment access"
      className="mt-6 space-y-5 rounded-2xl border border-teal-200 bg-white p-5 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]"
    >
      <div>
        <h2 className="text-base font-bold text-ink-900">Save your appointment</h2>
        <p className="mt-1 text-ink-600">
          You didn&rsquo;t create an account, so please do these two things now
          {whenText ? ` (your appointment: ${whenText})` : ""}.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-ink-900">1. Choose a PIN</h3>
        {pinSaved && !changing ? (
          <div className="mt-1 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-teal-900">
            <p>
              PIN saved. You&rsquo;ll need it with your mobile number ({info.phoneDisplay}) on{" "}
              <span className="font-semibold">Find my appointment</span>.
            </p>
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="mt-1 text-xs font-semibold text-teal-800 underline underline-offset-2"
            >
              Change my PIN
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-ink-600">
              If you lose the link, your mobile number ({info.phoneDisplay}) and this PIN get you back in. Choose
              numbers only you know.
            </p>
            {pinForm}
          </>
        )}
      </div>

      <div className="border-t border-[#e6f1ed] pt-4">
        <h3 className="font-semibold text-ink-900">2. Keep your appointment link</h3>
        <p className="mt-1 text-xs text-ink-500">
          Tapping WhatsApp may switch to another app, so choose your PIN first.
        </p>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <button
                type="button"
                onClick={shareToSelf}
                className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                Send link to myself
              </button>
            )}
            <a
              href={`https://wa.me/${info.phoneNorm}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                canShare
                  ? "border border-teal-300 bg-white text-teal-800 hover:bg-teal-50"
                  : "bg-teal-700 text-white hover:bg-teal-800"
              }`}
            >
              Send to my WhatsApp
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-full border border-teal-300 bg-white px-4 py-2 text-sm font-semibold text-teal-800 shadow-sm transition hover:bg-teal-50"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <input
            readOnly
            value={info.url}
            aria-label="Your appointment link"
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full rounded-md border border-[#d7e7e2] bg-[#f7fbf9] px-3 py-2 text-xs text-ink-600"
          />
          <p className="text-xs text-ink-500">
            Anyone with this link can open your appointment, so only send it to yourself.
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-[#f1f8f5] p-3 text-xs leading-relaxed text-ink-700">
        <p className="font-semibold text-ink-900">How to come back later</p>
        <p className="mt-1">
          Open your saved link, or go to <span className="font-semibold">thefamilymedic.com</span> &rarr;{" "}
          <span className="font-semibold">Find my appointment</span> and enter your mobile number and PIN.
        </p>
        <p className="mt-1">
          <span className="font-semibold">Forgot your PIN?</span> Open your saved link (or this page while you&rsquo;re
          still signed in on this phone) and choose a new one with &ldquo;Change my PIN&rdquo;.
        </p>
        <p className="mt-1">
          You can open your appointment until {GUEST_ACCESS_DAYS} days after it ends
          {untilText ? ` (currently ${untilText})` : ""}. Please download your prescription before then.
        </p>
      </div>
    </section>
  );
}
