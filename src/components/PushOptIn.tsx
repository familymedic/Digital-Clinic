"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  serializeSubscription,
} from "@/lib/push";

// Push-notification opt-in (2026-10-01), rendered once in NavBar.tsx so
// it appears for every logged-in role — patient, doctor, and admin —
// from one place, the same "fix it once at the shared layer" approach
// already used for the mobile nav Home-link fix. Deliberately a small,
// unobtrusive control (not a banner like InstallAppBanner) since this
// is a secondary, optional step most people will only notice once —
// turning it on, not something that needs repeated prompting.
//
// Quietly renders nothing at all if the browser doesn't support Web
// Push (e.g. iOS Safari when the site hasn't been "Add to Home
// Screen"-installed yet) — there's no useful action to offer there, and
// InstallAppBanner already covers telling an iPhone user how to install
// in the first place.
export default function PushOptIn({ accountId }: { accountId: string }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) return;
    setSupported(true);
    getExistingPushSubscription()
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  if (!supported) return null;

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const sub = await subscribeToPush();
      if (supabase) {
        const { endpoint, p256dh, auth_key } = serializeSubscription(sub);
        const { error: dbError } = await supabase.from("push_subscriptions").upsert(
          {
            account_id: accountId,
            endpoint,
            p256dh,
            auth_key,
            user_agent: navigator.userAgent,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" }
        );
        if (dbError) throw dbError;
      }
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      const sub = await getExistingPushSubscription();
      if (sub && supabase) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn off notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={subscribed ? handleDisable : handleEnable}
        disabled={busy}
        title={subscribed ? "Notifications on — click to turn off" : "Enable notifications"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
          subscribed ? "bg-teal-50 text-teal-700" : "text-ink-500 hover:bg-[var(--background)]"
        } disabled:opacity-50`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={subscribed ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>
      {error && (
        <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border border-red-200 bg-white p-2 text-xs text-red-700 shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
