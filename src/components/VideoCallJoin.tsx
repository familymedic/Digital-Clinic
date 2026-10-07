"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/monitoredFetch";

// Phase 9, step 1: shared by the patient's and the doctor's call pages.
// Asks the server route (src/app/api/consultations/[id]/room) for a
// fresh, short-lived join link, then embeds Daily's own prebuilt call
// UI in an iframe — no custom video UI to build or maintain, per the
// "established service, not custom-built" principle (Section 23).

interface Props {
  consultationId: string;
  accessToken: string;
}

export default function VideoCallJoin({ consultationId, accessToken }: Props) {
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRoom() {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ joinUrl?: string }>(`/api/consultations/${consultationId}/room`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled) return;
        if (!result.ok || !result.data.joinUrl) {
          setError(result.error ?? "Couldn't start the call.");
        } else {
          setJoinUrl(result.data.joinUrl);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRoom();
    return () => {
      cancelled = true;
    };
  }, [consultationId, accessToken]);

  if (loading) {
    return <p className="text-sm text-slate-400">Setting up your call…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!joinUrl) {
    return null;
  }

  return (
    <iframe
      src={joinUrl}
      allow="camera; microphone; fullscreen; display-capture; autoplay"
      className="h-[70vh] w-full rounded-lg border border-slate-200"
    />
  );
}
