"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Doctor public profile page (2026-09-23). The /doctors directory card
// only ever showed a 3-line-clamped bio with no way to read the rest —
// flagged directly by the physician: "i cannot open the doctor profile
// as general client to read complete bio of any doctor." Reuses the
// same public_doctor_directory view (0028/0034) the directory already
// queries — that view already carries the full, un-truncated bio, so
// this page needs no new migration or API route, just a place to show
// it in full. Same "not live until approved" rule already enforced by
// the view: a doctor with no approved profile just shows the fields
// that are public (name/specialty/fee), same as their directory card.

interface DirectoryDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  bio: string | null;
  years_of_experience: number | null;
  profile_photo_url: string | null;
}

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DoctorProfile() {
  const params = useParams<{ id: string }>();
  const [doctor, setDoctor] = useState<DirectoryDoctor | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !params.id) return;
    supabase
      .from("public_doctor_directory")
      .select("id, full_name, specialty, consultation_fee, bio, years_of_experience, profile_photo_url")
      .eq("id", params.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setDoctor((data as DirectoryDoctor | null) ?? null);
        }
      });
  }, [params.id]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Doctor Profile" />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Doctor Profile" />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href="/doctors" className="text-xs font-semibold text-teal-700 hover:text-teal-800">
          ← All doctors
        </Link>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load this doctor&rsquo;s profile: {error}
          </div>
        )}

        {doctor === undefined && !error && <p className="mt-6 text-sm text-ink-500">Loading…</p>}

        {doctor === null && !error && (
          <div className="mt-6 rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
            We couldn&rsquo;t find that doctor — they may no longer be available for booking.
            <div className="mt-4">
              <Link href="/doctors" className="font-semibold text-teal-700 hover:text-teal-800">
                Browse our doctors →
              </Link>
            </div>
          </div>
        )}

        {doctor && (
          <div className="mt-6 rounded-2xl border border-ink-border bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-4">
              {doctor.profile_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={doctor.profile_photo_url}
                  alt={doctor.full_name}
                  className="h-20 w-20 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-2xl font-bold text-white">
                  {initials(doctor.full_name)}
                </div>
              )}
              <div>
                <h2 className="text-lg font-bold text-ink-900 sm:text-xl">{doctor.full_name}</h2>
                <div className="mt-0.5 text-sm text-ink-500">
                  {doctor.specialty ?? "General Practice"}
                  {doctor.years_of_experience != null && <> · {doctor.years_of_experience} yrs experience</>}
                </div>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800">
                  ✓ PMDC Verified
                </div>
              </div>
            </div>

            {doctor.bio ? (
              <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-ink-700">{doctor.bio}</p>
            ) : (
              <p className="mt-6 text-sm text-ink-500">This doctor hasn&rsquo;t added a personal bio yet.</p>
            )}

            <div className="mt-6 flex flex-col gap-4 border-t border-ink-border pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-ink-700">
                Consultation fee:{" "}
                <span className="font-semibold text-ink-900">PKR {doctor.consultation_fee ?? "—"}</span>
              </div>
              <Link
                href={`/book?doctorId=${doctor.id}`}
                className="rounded-md bg-teal-700 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                Book a consultation
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
