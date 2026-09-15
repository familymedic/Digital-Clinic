"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Sponsored ads (2026-09-15): the one public-facing piece. Reads
// `active_sponsored_ads` (0035) — a security-definer view that already
// filters to status = 'active' AND today's date within the ad's own
// range, so this component never has to reason about scheduling itself,
// only about what to do with whatever rows it gets back.
//
// Deliberately renders nothing at all (returns null) when there's no
// live sponsor — the confirmed requirement was "without disturbing the
// website visuals," so an empty sponsor slate should leave zero visual
// trace, not an empty box. If more than one sponsor is live at once, it
// rotates between them one at a time (confirmed) rather than showing
// several at once, so the page's shape never changes based on how many
// sponsors happen to be running.
//
// Images only for this first build (confirmed) — video is a real
// follow-up, not this component's job yet.

interface ActiveAd {
  id: string;
  sponsor_name: string;
  image_url: string;
  click_url: string | null;
}

const ROTATE_MS = 7000;

export default function SponsoredAdSlot() {
  const [ads, setAds] = useState<ActiveAd[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("active_sponsored_ads")
      .select("id, sponsor_name, image_url, click_url")
      .then(({ data, error }) => {
        if (!error && data) setAds(data as ActiveAd[]);
      });
  }, []);

  useEffect(() => {
    if (!ads || ads.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % ads.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [ads]);

  if (!ads || ads.length === 0) return null;

  const ad = ads[index % ads.length];

  const content = (
    <div className="relative overflow-hidden rounded-2xl border border-ink-border bg-white shadow-sm">
      <span className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
        Sponsored
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ad.image_url} alt={ad.sponsor_name} className="h-28 w-full object-cover sm:h-32" />
    </div>
  );

  return (
    <section className="mx-auto max-w-6xl px-4 pb-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {ad.click_url ? (
          <a href={ad.click_url} target="_blank" rel="noopener noreferrer sponsored" aria-label={`Sponsored: ${ad.sponsor_name}`}>
            {content}
          </a>
        ) : (
          content
        )}
      </div>
    </section>
  );
}
