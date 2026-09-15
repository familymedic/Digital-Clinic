"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Doctor onboarding, step 3: a public doctor directory — patients can
// see and choose a doctor by department before booking, per the
// physician's explicit request. Reads from `public_doctor_directory`
// (0028), a view exposing only safe columns (name, specialty, fee) for
// doctors who are actually approved/active/fee-approved — never the
// full doctor_profiles table, which also holds PMDC numbers and
// certificate paths that have no business being public. No login
// required to view this page, matching the very first ask in this
// project's redesign conversation: "there should be some doctor profile
// on front page."

// Doctor public profile (2026-09-15): the view now also carries bio,
// years_of_experience, and profile_photo_url — each null unless that
// doctor has submitted a profile AND an admin approved it (0034), so a
// doctor who hasn't gotten there yet just falls back to the same
// initials-avatar / fee-only card as before.

interface DirectoryDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  bio: string | null;
  years_of_experience: number | null;
  profile_photo_url: string | null;
}

const AVATAR_TONES = [
  "from-teal-500 to-teal-700",
  "from-indigo-500 to-indigo-700",
  "from-amber-500 to-amber-700",
  "from-rose-500 to-rose-700",
];

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DoctorDirectory() {
  const [doctors, setDoctors] = useState<DirectoryDoctor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSpecialty, setActiveSpecialty] = useState<string>("All");

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("public_doctor_directory")
      .select("id, full_name, specialty, consultation_fee, bio, years_of_experience, profile_photo_url")
      .order("full_name", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setDoctors(data as DirectoryDoctor[]);
        }
      });
  }, []);

  const specialties = useMemo(() => {
    if (!doctors) return [];
    return Array.from(new Set(doctors.map((d) => d.specialty ?? "Other"))).sort();
  }, [doctors]);

  const visible = useMemo(() => {
    if (!doctors) return [];
    if (activeSpecialty === "All") return doctors;
    return doctors.filter((d) => (d.specialty ?? "Other") === activeSpecialty);
  }, [doctors, activeSpecialty]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Our Doctors" />
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
      <PageHeader
        title="Our Doctors"
        subtitle="PMDC-verified physicians, by department. Pick a doctor to book with directly."
      />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&rsquo;t load doctors: {error}
          </div>
        )}

        {doctors === null && !error && <p className="text-sm text-ink-500">Loading…</p>}

        {doctors && doctors.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
            No doctors are listed yet — check back soon.
          </div>
        )}

        {doctors && doctors.length > 0 && (
          <>
            <div className="mb-8 flex flex-wrap gap-2">
              {["All", ...specialties].map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSpecialty(s)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                    activeSpecialty === s
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((d, i) => (
                <div
                  key={d.id}
                  className="flex flex-col rounded-2xl border border-ink-border bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {d.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.profile_photo_url}
                        alt={d.full_name}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[i % AVATAR_TONES.length]} text-sm font-bold text-white`}
                      >
                        {initials(d.full_name)}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold text-ink-900">{d.full_name}</div>
                      <div className="text-xs text-ink-500">
                        {d.specialty ?? "General Practice"}
                        {d.years_of_experience != null && <> · {d.years_of_experience} yrs experience</>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800">
                    ✓ PMDC Verified
                  </div>

                  {d.bio && <p className="mt-3 line-clamp-3 text-xs text-ink-600">{d.bio}</p>}

                  <div className="mt-4 text-sm text-ink-700">
                    Consultation fee: <span className="font-semibold text-ink-900">PKR {d.consultation_fee ?? "—"}</span>
                  </div>

                  <Link
                    href={`/book?doctorId=${d.id}`}
                    className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
                  >
                    Book a consultation
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
