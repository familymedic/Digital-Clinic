"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";

// Doctor public profile (2026-09-15): lets a doctor submit their own
// bio, years of experience, and photo for the public directory — but
// none of it goes live on its own. It's written through
// /api/doctors/profile (a service-role route that only ever touches the
// caller's own row) and always lands as profile_status='pending_review'
// regardless of what's submitted; only an admin approving it
// (/admin/doctors) makes it visible on public_doctor_directory. A CNIC
// scan + number is required the first time, alongside the PMDC
// certificate already collected at registration — once one is on file,
// it's never asked for again.

interface ProfileRow {
  bio: string | null;
  years_of_experience: number | null;
  profile_photo_url: string | null;
  cnic_certificate_path: string | null;
  profile_status: "not_submitted" | "pending_review" | "approved" | "rejected";
  profile_rejection_reason: string | null;
}

const STATUS_BANNER: Record<ProfileRow["profile_status"], { style: string; text: string }> = {
  not_submitted: {
    style: "border-slate-200 bg-slate-50 text-slate-700",
    text: "You haven't submitted a public profile yet — patients will just see your name, specialty, and fee until you do.",
  },
  pending_review: {
    style: "border-amber-200 bg-amber-50 text-amber-900",
    text: "Your profile is submitted and awaiting admin approval — it isn't visible to patients yet.",
  },
  approved: {
    style: "border-teal-200 bg-teal-50 text-teal-900",
    text: "Your profile is live on the public doctor directory. Saving changes below sends it back for a quick re-approval.",
  },
  rejected: {
    style: "border-red-200 bg-red-50 text-red-800",
    text: "Your last submission wasn't approved. Please update it below and resubmit.",
  },
};

export default function DoctorProfile() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } =
    useDoctorProfileWithSignOut();

  const [row, setRow] = useState<ProfileRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bio, setBio] = useState("");
  const [years, setYears] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [cnicNumber, setCnicNumber] = useState("");
  const [cnicCertificate, setCnicCertificate] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("doctor_profiles")
      .select("bio, years_of_experience, profile_photo_url, cnic_certificate_path, profile_status, profile_rejection_reason")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      return;
    }
    const r = data as ProfileRow;
    setRow(r);
    setBio(r.bio ?? "");
    setYears(r.years_of_experience != null ? String(r.years_of_experience) : "");
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !session) return;
    setSubmitError(null);
    setSubmitSuccess(false);

    const form = new FormData();
    form.set("bio", bio.trim());
    form.set("yearsOfExperience", years.trim());
    if (photo) form.set("photo", photo);
    const needsCnic = !row?.cnic_certificate_path;
    if (needsCnic) {
      form.set("cnicNumber", cnicNumber.trim());
      if (cnicCertificate) form.set("cnicCertificate", cnicCertificate);
    }

    setSubmitting(true);
    const {
      data: { session: freshSession },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/doctors/profile", {
      method: "POST",
      headers: { Authorization: `Bearer ${freshSession?.access_token ?? ""}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError(data.error ?? "Couldn't submit your profile.");
      return;
    }
    setSubmitSuccess(true);
    setPhoto(null);
    setCnicCertificate(null);
    setCnicNumber("");
    await load();
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="profile">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
      </DoctorShell>
    );
  }

  if (authLoading || profileChecking) {
    return (
      <DoctorShell active="profile">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  if (!session) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
          <p>Please log in with your doctor account first.</p>
          <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
            Doctor log in
          </Link>
        </div>
      </DoctorShell>
    );
  }

  if (profileError) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }

  if (!profile) {
    return (
      <DoctorShell active="profile">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <div className="mt-4 flex gap-4">
            <button onClick={() => signOut()} className="font-semibold text-teal-700 underline underline-offset-2">
              Log out
            </button>
            <Link href="/doctor/login" className="font-semibold text-teal-700 underline underline-offset-2">
              Doctor log in
            </Link>
          </div>
        </div>
      </DoctorShell>
    );
  }

  if (loadError) {
    return (
      <DoctorShell active="profile" doctorName={profile.full_name} onSignOut={signOut}>
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load your profile: {loadError}
        </div>
      </DoctorShell>
    );
  }

  if (row === undefined) {
    return (
      <DoctorShell active="profile" doctorName={profile.full_name} onSignOut={signOut}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }

  const needsCnic = !row?.cnic_certificate_path;
  const banner = STATUS_BANNER[row?.profile_status ?? "not_submitted"];

  return (
    <DoctorShell active="profile" doctorName={profile.full_name} onSignOut={signOut}>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
          My Profile
        </h1>

        <div className={`mt-6 rounded-2xl border p-4 text-sm ${banner.style}`}>
          {banner.text}
          {row?.profile_status === "rejected" && row.profile_rejection_reason && (
            <p className="mt-2 font-semibold">Reason: {row.profile_rejection_reason}</p>
          )}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-ink-border bg-white p-6 shadow-sm">
          {row?.profile_photo_url && (
            <div className="flex items-center gap-3">
              <img
                src={row.profile_photo_url}
                alt="Current profile photo"
                className="h-16 w-16 rounded-full object-cover"
              />
              <span className="text-xs text-slate-500">Current photo — upload a new one below to replace it.</span>
            </div>
          )}

          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-slate-700">
              Bio <span className="text-teal-700">*</span>
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="Your training, areas of focus, and the kind of care patients can expect…"
              className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
            <p className="mt-1 text-xs text-slate-400">{bio.length}/1000 characters.</p>
          </div>

          <div>
            <label htmlFor="years" className="block text-sm font-medium text-slate-700">
              Years of experience <span className="text-teal-700">*</span>
            </label>
            <input
              id="years"
              type="number"
              min={0}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              placeholder="e.g. 8"
              className="mt-1.5 block w-40 rounded-md border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>

          <div>
            <label htmlFor="photo" className="block text-sm font-medium text-slate-700">
              Profile photo {!row?.profile_photo_url && <span className="text-teal-700">*</span>}
            </label>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-slate-700"
            />
            <p className="mt-1 text-xs text-slate-400">JPG, PNG, or WEBP — up to 8MB. Optional if you already have one on file.</p>
          </div>

          {needsCnic && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Identity verification required</p>
              <p className="mt-1 text-xs text-amber-800">
                Since this is your first public profile submission, we also need your CNIC — a one-time
                identity check on top of the PMDC certificate you already provided.
              </p>
              <div className="mt-3">
                <label htmlFor="cnicNumber" className="block text-sm font-medium text-slate-700">
                  CNIC number <span className="text-teal-700">*</span>
                </label>
                <input
                  id="cnicNumber"
                  type="text"
                  value={cnicNumber}
                  onChange={(e) => setCnicNumber(e.target.value)}
                  placeholder="e.g. 42101-1234567-1"
                  className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                />
              </div>
              <div className="mt-3">
                <label htmlFor="cnicCertificate" className="block text-sm font-medium text-slate-700">
                  Scanned CNIC <span className="text-teal-700">*</span>
                </label>
                <input
                  id="cnicCertificate"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setCnicCertificate(e.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full text-sm text-slate-700"
                />
                <p className="mt-1 text-xs text-slate-400">JPG, PNG, WEBP, or PDF — up to 8MB. Kept private, never shown publicly.</p>
              </div>
            </div>
          )}

          {submitError && <p className="text-sm text-red-700">{submitError}</p>}
          {submitSuccess && (
            <p className="text-sm text-teal-700">Submitted — it&rsquo;s now awaiting admin approval.</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
        </form>
      </div>
    </DoctorShell>
  );
}
