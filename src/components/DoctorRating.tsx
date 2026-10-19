"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Public doctor star ratings (migration 0080). Everything here is fail-soft:
// until 0080 has been run, the summary query errors, the map stays empty and
// every doctor simply shows "New" - nothing breaks.
//
// A single star average from one or two reviews can mislead, so an average is
// only shown once a doctor has MIN_REVIEWS_TO_SHOW verified reviews; before
// that the doctor shows a neutral "New on Family Medic" badge instead of 0.

export const MIN_REVIEWS_TO_SHOW = 3;

export interface RatingSummary {
  doctor_id: string;
  avg_rating: number;
  review_count: number;
}

export type RatingMap = Record<string, RatingSummary>;

// One query for every doctor on the page, shared by cards/lists.
export function useDoctorRatings(): RatingMap {
  const [map, setMap] = useState<RatingMap>({});
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("doctor_rating_summary")
      .select("doctor_id, avg_rating, review_count")
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const next: RatingMap = {};
        for (const r of data as { doctor_id: string; avg_rating: number | string; review_count: number }[]) {
          next[r.doctor_id] = {
            doctor_id: r.doctor_id,
            avg_rating: Number(r.avg_rating),
            review_count: Number(r.review_count),
          };
        }
        setMap(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

function Star({ fill, size }: { fill: number; size: number }) {
  // fill: 0..1 - how much of the star is gold.
  const id = `st${Math.round(fill * 100)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${fill * 100}%`} stopColor="#f5a623" />
          <stop offset={`${fill * 100}%`} stopColor="#d6dedb" />
        </linearGradient>
      </defs>
      <path
        d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={Math.max(0, Math.min(1, value - (n - 1)))} />
      ))}
    </span>
  );
}

// Compact rating line for doctor cards: "★★★★★ 4.8 (23)" or "New".
export function RatingBadge({
  summary,
  size = 14,
  className = "",
}: {
  summary: RatingSummary | undefined;
  size?: number;
  className?: string;
}) {
  if (!summary || summary.review_count < MIN_REVIEWS_TO_SHOW) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-[#eef6f3] px-2 py-0.5 text-[10.5px] font-bold text-teal-800 ${className}`}
      >
        New on Family Medic
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`Rated ${summary.avg_rating.toFixed(1)} out of 5 from ${summary.review_count} verified reviews`}
    >
      <Stars value={summary.avg_rating} size={size} />
      <span className="text-[12.5px] font-extrabold text-ink-900">{summary.avg_rating.toFixed(1)}</span>
      <span className="text-[11.5px] font-medium text-ink-500">({summary.review_count})</span>
    </span>
  );
}

interface PublicReview {
  id: string;
  rating: number;
  message: string;
  created_at: string;
}

// Written reviews on a doctor's profile: approved comments only, shown as
// "Verified patient" - the view carries no identity at all.
export function DoctorReviewsList({ doctorId }: { doctorId: string }) {
  const [reviews, setReviews] = useState<PublicReview[] | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("public_doctor_reviews")
      .select("id, rating, message, created_at")
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setReviews(data as PublicReview[]);
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  if (!reviews || reviews.length === 0) return null;
  return (
    <div className="mt-8 border-t border-[#e6efec] pt-7">
    <h3 className="text-sm font-extrabold uppercase tracking-wider text-teal-700">Patient reviews</h3>
    <ul className="mt-4 space-y-3">
      {reviews.map((r) => (
        <li key={r.id} className="rounded-2xl bg-[#f5faf8] p-4">
          <div className="flex items-center justify-between gap-2">
            <Stars value={r.rating} size={13} />
            <span className="text-[11px] font-medium text-ink-500">
              {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{r.message}</p>
          <p className="mt-2 text-[11px] font-bold text-teal-700">✓ Verified patient</p>
        </li>
      ))}
    </ul>
    </div>
  );
}
