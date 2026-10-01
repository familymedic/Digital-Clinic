"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Featured reviews on the homepage for marketing (2026-09-30/10-01,
// physician: "i dont havent seen how i can display good reviews on
// main the main page for marketing"). Reads `public_featured_reviews`
// (0054) — a public view that only ever returns reviews (never
// complaints) an admin has explicitly chosen to feature from
// /admin/feedback, with a privacy-safe display name (first name + last
// initial) computed inside the view itself — the real submitter
// identity never reaches this component at all.
//
// Same "renders nothing at all when there's nothing to show" rule as
// SponsoredAdSlot: until an admin actually features a review, this
// section leaves zero visual trace on the homepage rather than showing
// an empty "What patients say" box.

interface FeaturedReview {
  id: string;
  rating: number | null;
  message: string | null;
  display_name: string;
}

export default function FeaturedReviews() {
  const [reviews, setReviews] = useState<FeaturedReview[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("public_featured_reviews")
      .select("id, rating, message, display_name")
      .limit(9)
      .then(({ data, error }) => {
        if (!error && data) setReviews(data as FeaturedReview[]);
      });
  }, []);

  if (!reviews || reviews.length === 0) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="text-center">
          <span className="inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
            What patients say
          </span>
          <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Real feedback from real consultations
          </h2>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-2xl border border-ink-border bg-[var(--background)] p-6 shadow-sm">
              {r.rating != null && (
                <div className="text-amber-500" aria-label={`${r.rating} out of 5 stars`}>
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}
                </div>
              )}
              {r.message && (
                <p className="mt-3 text-sm leading-relaxed text-ink-700">&ldquo;{r.message}&rdquo;</p>
              )}
              <p className="mt-4 text-xs font-semibold text-ink-500">{r.display_name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
