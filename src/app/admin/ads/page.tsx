"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";

// Sponsored ads (2026-09-15): the physician asked whether pharma
// companies renting a paid, clearly-labeled ad placement on the home
// page could help with revenue — confirmed as doable and worth building,
// with three decisions scoped first: images only for now (video is a
// real follow-up step, not this one), a single rotating "Sponsored" slot
// on the page if more than one sponsor's dates overlap, and no
// price/payment tracking in the app at all (that's handled entirely
// outside the platform, the same way doctor payouts are a manual bank
// transfer this app only records, not the number a sponsor pays here).
//
// One important thing worth restating for whoever manages this screen:
// Pakistan's DRAP restricts advertising of prescription medicines to the
// general public entirely, and requires their own Committee on
// Advertisement approval before an OTC medicine can be advertised
// online at all (Form-8). That's the sponsor's own regulatory
// responsibility, not something this app checks — but it's worth making
// a condition of any sponsorship agreement (no prescription-only
// products; sponsor confirms their creative is DRAP-approved) rather
// than assuming it.
//
// Pausing/resuming an ad is a plain RLS-backed update (admin already has
// full write access to sponsored_ads, same as every other admin-managed
// table); creating one (needs a storage upload) and deleting one (needs
// storage cleanup) go through the two API routes instead, since every
// storage bucket in this app has zero storage policies by design.

interface AdRow {
  id: string;
  sponsor_name: string;
  image_url: string;
  click_url: string | null;
  starts_at: string;
  ends_at: string;
  status: "active" | "paused";
  created_at: string;
}

function computeState(row: AdRow): { label: string; className: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (row.status === "paused") return { label: "Paused", className: "bg-slate-200 text-slate-600" };
  if (today < row.starts_at) return { label: "Scheduled", className: "bg-amber-100 text-amber-800" };
  if (today > row.ends_at) return { label: "Expired", className: "bg-slate-200 text-slate-500" };
  return { label: "Live now", className: "bg-teal-100 text-teal-800" };
}

export default function AdminAds() {
  const [rows, setRows] = useState<AdRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const [sponsorName, setSponsorName] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("sponsored_ads")
      .select("id, sponsor_name, image_url, click_url, starts_at, ends_at, status, created_at")
      .order("starts_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as AdRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePause(row: AdRow) {
    if (!supabase) return;
    setUpdating(row.id);
    const { error } = await supabase
      .from("sponsored_ads")
      .update({ status: row.status === "active" ? "paused" : "active" })
      .eq("id", row.id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function deleteAd(id: string) {
    if (!supabase) return;
    setUpdating(id);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/ads/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    const data = await res.json().catch(() => ({}));
    setUpdating(null);
    if (!res.ok) {
      setLoadError(data.error ?? "Couldn't delete this ad.");
      return;
    }
    await load();
  }

  async function createAd(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setCreateError(null);
    setCreateSuccess(null);

    if (!sponsorName.trim() || !startsAt || !endsAt || !imageFile) {
      setCreateError("Please fill in the sponsor name, both dates, and choose an image.");
      return;
    }

    setCreating(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const form = new FormData();
    form.set("sponsorName", sponsorName.trim());
    form.set("clickUrl", clickUrl.trim());
    form.set("startsAt", startsAt);
    form.set("endsAt", endsAt);
    form.set("image", imageFile);

    const res = await fetch("/api/admin/ads", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);

    if (!res.ok) {
      setCreateError(data.error ?? "Something went wrong.");
      return;
    }

    setCreateSuccess(`${sponsorName.trim()} is scheduled — it'll show on the home page automatically between those dates.`);
    setSponsorName("");
    setClickUrl("");
    setStartsAt("");
    setEndsAt("");
    setImageFile(null);
    await load();
  }

  return (
    <AdminGuard title="Sponsored ads">
      {() => (
        <div>
          <PageHeader
            title="Sponsored ads"
            subtitle="A paid, clearly-labeled sponsor placement on the home page. No price is tracked here — that's handled outside the platform."
          />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700">{loadError}</p>}

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Add a sponsor</h2>
              <p className="mt-1 text-xs text-slate-500">
                Image ads only for now. It automatically shows on the home page — with a visible &ldquo;Sponsored&rdquo;
                label — for exactly the date range below, and automatically stops the moment it ends.
              </p>
              <form onSubmit={createAd} className="mt-4 space-y-4">
                <FormField label="Sponsor name" name="sponsorName" value={sponsorName} onChange={setSponsorName} required />
                <FormField
                  label="Click-through link"
                  name="clickUrl"
                  type="url"
                  value={clickUrl}
                  onChange={setClickUrl}
                  placeholder="https://"
                  hint="Optional — where a patient goes if they click the ad."
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Start date" name="startsAt" type="date" value={startsAt} onChange={setStartsAt} required />
                  <FormField label="End date" name="endsAt" type="date" value={endsAt} onChange={setEndsAt} required />
                </div>
                <div>
                  <label htmlFor="adImage" className="block text-sm font-medium text-slate-700">
                    Ad image <span className="text-teal-700">*</span>
                  </label>
                  <input
                    id="adImage"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                    className="mt-1.5 block w-full text-sm text-slate-600"
                  />
                  <p className="mt-1 text-xs text-slate-400">JPG, PNG, or WEBP, up to 5MB. A wide banner shape works best.</p>
                </div>
                {createError && <p className="text-sm text-red-700">{createError}</p>}
                {createSuccess && <p className="text-sm text-teal-700">{createSuccess}</p>}
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {creating ? "Uploading…" : "Add sponsor"}
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                All sponsors {rows && rows.length > 0 && `(${rows.length})`}
              </h2>
              {rows === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No sponsors added yet.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {rows.map((row) => {
                    const state = computeState(row);
                    return (
                      <li key={row.id} className="flex flex-wrap items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.image_url}
                          alt={row.sponsor_name}
                          className="h-16 w-28 shrink-0 rounded-md border border-slate-200 object-cover"
                        />
                        <div className="min-w-[180px] flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{row.sponsor_name}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state.className}`}>
                              {state.label}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {row.starts_at} → {row.ends_at}
                            {row.click_url && (
                              <>
                                {" · "}
                                <a href={row.click_url} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline underline-offset-2">
                                  {row.click_url}
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            onClick={() => togglePause(row)}
                            disabled={updating === row.id}
                            className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            {row.status === "active" ? "Pause" : "Resume"}
                          </button>
                          <button
                            onClick={() => deleteAd(row.id)}
                            disabled={updating === row.id}
                            className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
