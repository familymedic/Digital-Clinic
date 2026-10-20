"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import FormField from "@/components/FormField";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/monitoredFetch";

// Home-page pop-up (migration 0082). Upload a flyer, choose the dates and
// where its button goes; it opens over the home page for visitors during
// those dates and stops by itself afterwards. Pause/Resume is a plain
// RLS-backed update; creating (storage upload) and deleting (storage
// clean-up) go through /api/admin/popups.

interface PopupRow {
  id: string;
  title: string;
  image_url: string;
  click_url: string | null;
  button_label: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "paused";
  created_at: string;
}

function todayPkt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

function computeState(row: PopupRow): { label: string; className: string } {
  const today = todayPkt();
  if (row.status === "paused") return { label: "Paused", className: "bg-slate-200 text-slate-600" };
  if (today < row.starts_at) return { label: "Scheduled", className: "bg-amber-100 text-amber-800" };
  if (today > row.ends_at) return { label: "Expired", className: "bg-slate-200 text-slate-500" };
  return { label: "Live now", className: "bg-teal-100 text-teal-800" };
}

export default function AdminPopups() {
  const [rows, setRows] = useState<PopupRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [clickUrl, setClickUrl] = useState("/free-week");
  const [buttonLabel, setButtonLabel] = useState("Register free");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // remounts the file box after a successful add so it shows empty
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("site_popups")
      .select("id, title, image_url, click_url, button_label, starts_at, ends_at, status, created_at")
      .order("starts_at", { ascending: false });
    if (error) {
      setLoadError(
        /site_popups|schema cache|does not exist/i.test(error.message)
          ? "The pop-up database step (SQL 0082) hasn't been run yet."
          : error.message
      );
      return;
    }
    setLoadError(null);
    setRows(data as PopupRow[]);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function pickImage(file: File | null) {
    setImageFile(file);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function togglePause(row: PopupRow) {
    if (!supabase) return;
    setUpdating(row.id);
    const { error } = await supabase
      .from("site_popups")
      .update({ status: row.status === "active" ? "paused" : "active" })
      .eq("id", row.id);
    setUpdating(null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    await load();
  }

  async function deletePopup(id: string) {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this pop-up and its image? This can't be undone.")) return;
    setUpdating(id);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { res, data } = await safeJson(`/api/admin/popups/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    setUpdating(null);
    if (!res.ok) {
      setLoadError(data.error ?? "Couldn't delete this pop-up.");
      return;
    }
    await load();
  }

  async function createPopup(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setCreateError(null);
    setCreateSuccess(null);

    if (!title.trim() || !startsAt || !endsAt || !imageFile) {
      setCreateError("Please fill in the name, both dates, and choose the flyer image.");
      return;
    }

    setCreating(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const form = new FormData();
    form.set("title", title.trim());
    form.set("clickUrl", clickUrl.trim());
    form.set("buttonLabel", buttonLabel.trim());
    form.set("startsAt", startsAt);
    form.set("endsAt", endsAt);
    form.set("image", imageFile);

    const { res, data } = await safeJson("/api/admin/popups", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: form,
    });
    setCreating(false);

    if (!res.ok) {
      setCreateError(data.error ?? "Something went wrong.");
      return;
    }

    setCreateSuccess(`"${title.trim()}" is scheduled — it will open on the home page automatically between those dates.`);
    setTitle("");
    setStartsAt("");
    setEndsAt("");
    pickImage(null);
    setFileKey((n) => n + 1);
    await load();
  }

  return (
    <AdminGuard title="Home pop-up">
      {() => (
        <div>
          <PageHeader
            title="Home pop-up"
            subtitle="A flyer that opens over the home page, with a close button. Use it for announcements like the free week."
          />
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
            <Link href="/admin" className="text-sm font-medium text-teal-700 underline underline-offset-2">
              ← Back to admin
            </Link>

            {loadError && <p className="text-sm text-red-700" data-testid="popup-load-error">{loadError}</p>}

            <section className="rounded-3xl border border-[#d7e7e2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
              <h2 className="text-sm font-semibold text-ink-900">Add a pop-up</h2>
              <p className="mt-1 text-xs text-ink-500">
                It opens about 2 seconds after the home page loads, only on the home page. If a visitor closes it, they
                won&rsquo;t see it again on that phone for 24 hours. If two are live at once, the newest shows.
              </p>
              <form onSubmit={createPopup} className="mt-4 space-y-4">
                <FormField
                  label="Name (only you see this)"
                  name="title"
                  value={title}
                  onChange={setTitle}
                  placeholder="Free week pre-registration"
                  required
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Button goes to"
                    name="clickUrl"
                    value={clickUrl}
                    onChange={setClickUrl}
                    placeholder="/free-week"
                    hint="A page on this site such as /free-week, or a full https:// link. Leave empty for no button."
                  />
                  <FormField label="Button text" name="buttonLabel" value={buttonLabel} onChange={setButtonLabel} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Start date" name="startsAt" type="date" value={startsAt} onChange={setStartsAt} required />
                  <FormField label="End date" name="endsAt" type="date" value={endsAt} onChange={setEndsAt} required />
                </div>
                <div>
                  <label htmlFor="popupImage" className="block text-sm font-medium text-ink-700">
                    Flyer image <span className="text-teal-700">*</span>
                  </label>
                  <input
                    key={fileKey}
                    id="popupImage"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                    className="mt-1.5 block w-full text-sm text-ink-700"
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    JPG, PNG, or WEBP, up to 5MB. Portrait (4:5) or square works best on phones; it is shown whole, never cropped.
                  </p>
                </div>
                {previewUrl && (
                  <div>
                    <p className="text-xs font-medium text-ink-500">Preview (phone width)</p>
                    <div className="mt-1.5 inline-block rounded-3xl bg-black/65 p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Pop-up preview"
                        data-testid="popup-preview"
                        className="block max-h-[420px] w-auto rounded-2xl bg-white"
                        style={{ maxWidth: "min(calc(100vw - 6rem), 300px)" }}
                      />
                      {clickUrl.trim() && (
                        <div className="mt-2 rounded-xl bg-[#ffb454] px-3 py-2 text-center text-sm font-extrabold text-[#3a2500]">
                          {buttonLabel.trim() || "Register free"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {createError && <p className="text-sm text-red-700" data-testid="popup-create-error">{createError}</p>}
                {createSuccess && <p className="text-sm text-teal-700" data-testid="popup-create-ok">{createSuccess}</p>}
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
                >
                  {creating ? "Uploading…" : "Add pop-up"}
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                All pop-ups {rows && rows.length > 0 && `(${rows.length})`}
              </h2>
              <p className="mt-1 text-xs text-ink-500">
                To see a live one yourself, open the home page with <span className="font-mono">/?popup=1</span> on the end of the address.
              </p>
              {rows === null ? (
                <p className="mt-3 text-sm text-ink-500">{loadError ? "" : "Loading…"}</p>
              ) : rows.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">No pop-ups added yet.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {rows.map((row) => {
                    const state = computeState(row);
                    return (
                      <li
                        key={row.id}
                        data-testid="popup-row"
                        className="flex flex-wrap items-start gap-4 rounded-2xl border border-[#d7e7e2] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.image_url}
                          alt={row.title}
                          className="h-24 w-20 shrink-0 rounded-md border border-[#d7e7e2] bg-slate-50 object-contain"
                        />
                        <div className="min-w-[180px] flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink-900">{row.title}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state.className}`}>
                              {state.label}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-ink-500">
                            {row.starts_at} → {row.ends_at}
                            {row.click_url && (
                              <>
                                {" · "}
                                {row.button_label} → <span className="font-mono">{row.click_url}</span>
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
                            onClick={() => deletePopup(row.id)}
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
