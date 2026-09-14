"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";

// Admin system, step 2: doctor management. "Add a doctor" invites a new
// account by email (src/app/api/admin/doctors) and creates their
// doctor_profiles row in the same step — replacing what used to be a
// manual sign-up + SQL insert. Activate/deactivate is a plain RLS-backed
// update, no API route needed for that part.

interface DoctorRow {
  id: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
}

export default function AdminDoctors() {
  const [rows, setRows] = useState<DoctorRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("doctor_profiles")
      .select("id, full_name, is_active, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      setLoadError(error.message);
      return;
    }
    setRows(data as DoctorRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(id: string, next: boolean) {
    if (!supabase) return;
    setUpdating(id);
    const { error } = await supabase.from("doctor_profiles").update({ is_active: next }).eq("id", id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function addDoctor(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setAddError(null);
    setAddSuccess(null);

    if (!fullName.trim() || !email.trim()) {
      setAddError("Please enter both a name and an email.");
      return;
    }

    setAdding(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/admin/doctors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ fullName: fullName.trim(), email: email.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setAdding(false);

    if (!res.ok) {
      setAddError(data.error ?? "Something went wrong.");
      return;
    }

    setAddSuccess(`Invited ${fullName.trim()} — they'll get an email to set their own password.`);
    setFullName("");
    setEmail("");
    await load();
  }

  return (
    <AdminGuard title="Doctors">
      {() => (
        <div>
          <PageHeader title="Doctors" subtitle="Add a doctor, or activate/deactivate an existing one." />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Add a doctor</h2>
              <p className="mt-1 text-xs text-slate-500">
                They&rsquo;ll receive an email invite to set their own password — you never see or set it.
              </p>
              <form onSubmit={addDoctor} className="mt-4 space-y-4">
                <FormField label="Full name" name="fullName" value={fullName} onChange={setFullName} required />
                <FormField label="Email" name="email" type="email" value={email} onChange={setEmail} required />
                {addError && <p className="text-sm text-red-700">{addError}</p>}
                {addSuccess && <p className="text-sm text-teal-700">{addSuccess}</p>}
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-md bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {adding ? "Inviting…" : "Invite doctor"}
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">All doctors</h2>
              {loadError && <p className="mt-2 text-sm text-red-700">{loadError}</p>}
              {rows === null ? (
                <p className="mt-3 text-sm text-slate-400">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No doctors yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rows.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{d.full_name}</div>
                        <div className="text-xs text-slate-400">
                          Joined {new Date(d.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            d.is_active ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {d.is_active ? "Active" : "Inactive"}
                        </span>
                        <button
                          onClick={() => toggleActive(d.id, !d.is_active)}
                          disabled={updating === d.id}
                          className="text-xs font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          {d.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
