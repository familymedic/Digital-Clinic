"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import LocationPicker from "@/components/locator/LocationPicker";
import HoursEditor from "@/components/locator/HoursEditor";
import { supabase } from "@/lib/supabaseClient";
import { cleanHours, hoursSummary, type OpenHours } from "@/lib/locator";
import { REASON_TEXT, parseCsv, parseTable, toRpcRow, type ParsedRow, type ParsedSheet } from "@/lib/vaccination";

// Admin "Vaccination centres" (migration 0100). Free to list, no payment, no verification step:
// whatever an admin adds is live straight away. Two ways in:
//   1. one centre at a time (the form below), and
//   2. a whole Excel / CSV sheet at once, checked first (nothing is saved until you confirm),
//      so a district, or all of Sindh, can be loaded in one go.
// Everything goes through admin-only database functions.

const inputCls = "w-full rounded-xl border border-[#cfe0da] bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-teal-600";
const cardCls = "rounded-2xl border border-[#d7e7e2] bg-white p-4";
const btnPrimary = "rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50";
const btnGhost = "rounded-full border border-[#cfe0da] bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-[#f2f8f6] disabled:opacity-50";

const DISTRICTS = [
  "Karachi Central", "Karachi East", "Karachi South", "Karachi West", "Karachi Malir", "Karachi Korangi", "Karachi Keamari",
  "Hyderabad", "Jamshoro", "Sukkur", "Khairpur", "Larkana",
];

type VType = "government" | "private" | "both";
const VTYPE_LABEL: Record<VType, string> = { government: "Government vaccine", private: "Private vaccines", both: "Government and private vaccines" };

interface Centre {
  id: string;
  name: string;
  area: string;
  district: string | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  vaccines: string | null;
  source_note: string | null;
  last_verified: string | null;
  vaccine_type: VType | null;
  service_fee: boolean;
  lat: number;
  lng: number;
  hours: OpenHours | null;
  status: "pending" | "approved" | "hidden";
  import_batch: string | null;
  created_at: string;
}

interface Batch {
  id: string;
  label: string;
  rows_added: number;
  rows_updated: number;
  rows_skipped: number;
  created_at: string;
  undone_at: string | null;
}

interface RowResult {
  row: number;
  name: string | null;
  status: "new" | "update" | "error" | "duplicate" | null;
  reason: string | null;
}

interface ImportResult {
  committed: boolean;
  batch_id: string | null;
  counts: { new: number; update: number; error: number; duplicate: number };
  results: RowResult[];
}

interface FormState {
  name: string;
  district: string;
  area: string;
  address: string;
  phone: string;
  notes: string;
  vaccines: string;
  source_note: string;
  last_verified: string;
  vaccine_type: VType;
  service_fee: boolean;
  lat: string;
  lng: string;
  hours: OpenHours | null;
}

const EMPTY: FormState = {
  name: "", district: "", area: "", address: "", phone: "", notes: "", vaccines: "", source_note: "", last_verified: "", vaccine_type: "government", service_fee: false, lat: "", lng: "", hours: null,
};

function formFrom(c: Centre): FormState {
  return {
    name: c.name, district: c.district ?? "", area: c.area, address: c.address ?? "", phone: c.phone ?? "", notes: c.notes ?? "",
    vaccines: c.vaccines ?? "", source_note: c.source_note ?? "", last_verified: c.last_verified ?? "", vaccine_type: c.vaccine_type ?? "government", service_fee: c.service_fee === true, lat: String(c.lat), lng: String(c.lng), hours: c.hours,
  };
}

const FIELD_WORDS: Record<string, string> = {
  name: "centre name", district: "district", area: "town", uc: "UC", address: "address", lat: "latitude", lng: "longitude", maps: "Google Maps link",
  open: "opening time", close: "closing time", friopen: "Friday opening", friclose: "Friday closing", timings: "timings", days: "days open",
  vtype: "vaccines offered", fee: "service fee", vaccines: "vaccines", phone: "phone", type: "centre type", source: "source", verified: "last checked date",
};

function reasonText(code: string | null | undefined): string {
  if (!code) return "";
  const c = code.replace(/^.*invalid:/, "");
  return REASON_TEXT[c] ?? c.replace(/_/g, " ");
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const ageDays = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d + "T00:00:00Z").getTime()) / 86400000) : null);

function csvCell(v: unknown): string {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function download(name: string, text: string, type = "text/csv") {
  const blob = new Blob(["﻿" + text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function bearer(): Promise<string> {
  const s = await supabase?.auth.getSession();
  return s?.data.session?.access_token ?? "";
}

export default function AdminVaccination() {
  const [centres, setCentres] = useState<Centre[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [view, setView] = useState<"add" | "upload" | "list">("add");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // single centre
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // upload
  const [fileName, setFileName] = useState<string>("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [label, setLabel] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(true);

  // list
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState("all");
  const [shown, setShown] = useState(100);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [c, b] = await Promise.all([
      supabase
        .from("locator_places")
        .select("id,name,area,district,address,phone,notes,vaccines,source_note,last_verified,vaccine_type,service_fee,lat,lng,hours,status,import_batch,created_at")
        .eq("category", "vaccination")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("locator_import_batches").select("*").is("undone_at", null).order("created_at", { ascending: false }).limit(50),
    ]);
    const err = c.error || b.error;
    if (err) {
      setError(/does not exist|schema cache|vaccination|import_batches|vaccine_type|service_fee/i.test(err.message) ? "Vaccination centres need migrations 0100 and 0101 to be run once in Supabase. (" + err.message + ")" : err.message);
      setCentres([]);
      return;
    }
    setError(null);
    setCentres(((c.data ?? []) as Centre[]).map((x) => ({ ...x, lat: Number(x.lat), lng: Number(x.lng) })));
    setBatches((b.data ?? []) as Batch[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ---------------------------------------------------------------- single centre
  async function saveOne() {
    if (!supabase) return;
    setNotice(null);
    setError(null);
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (!form.name.trim()) return setError("Please enter the centre name.");
    if (!form.area.trim()) return setError("Please enter the area (town or UC).");
    if (form.lat === "" || form.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) return setError("Please set the pin: paste a Google Maps link or use GPS.");
    const row = {
      name: form.name.trim(), district: form.district.trim() || null, area: form.area.trim(), address: form.address.trim() || null,
      phone: form.phone.trim() || null, notes: form.notes.trim() || null, vaccines: form.vaccines.trim() || null,
      source_note: form.source_note.trim() || null, last_verified: form.last_verified || null, vaccine_type: form.vaccine_type, service_fee: form.service_fee, lat, lng, hours: cleanHours(form.hours),
    };
    setSaving(true);
    if (editingId) {
      const { error: e } = await supabase.rpc("locator_admin_vacc_update", { p_id: editingId, p_row: row });
      setSaving(false);
      if (e) return setError(reasonText(e.message) || e.message);
      setNotice(`Saved changes to "${row.name}".`);
    } else {
      const { data, error: e } = await supabase.rpc("locator_admin_vacc_import", { p_rows: [row], p_commit: true, p_label: null });
      setSaving(false);
      if (e) return setError(reasonText(e.message) || e.message);
      const res = data as ImportResult;
      if (res.counts.error || res.counts.duplicate) return setError(reasonText(res.results[0]?.reason) || "That centre could not be saved.");
      setNotice(
        res.counts.update
          ? `"${row.name}" was already listed at this place, so its details were updated.`
          : `"${row.name}" is now live in the Locator.`
      );
    }
    setForm(EMPTY);
    setEditingId(null);
    setFormKey((k) => k + 1);
    await load();
  }

  function startEdit(c: Centre) {
    setForm(formFrom(c));
    setEditingId(c.id);
    setFormKey((k) => k + 1);
    setView("add");
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function setStatus(c: Centre, status: Centre["status"]) {
    if (!supabase) return;
    const { error: e } = await supabase.from("locator_places").update({ status, reviewed_at: new Date().toISOString() }).eq("id", c.id);
    if (e) return setError(e.message);
    await load();
  }

  async function remove(c: Centre) {
    if (!supabase) return;
    if (!window.confirm(`Delete "${c.name}" permanently? This cannot be undone. (Use Hide if you may want it back.)`)) return;
    const { error: e } = await supabase.from("locator_places").delete().eq("id", c.id);
    if (e) return setError(e.message);
    await load();
  }

  // ---------------------------------------------------------------- sheet upload
  async function resolveLinks(list: ParsedRow[]): Promise<ParsedRow[]> {
    const urls = Array.from(new Set(list.map((r) => r.needsResolve).filter((x): x is string => !!x)));
    if (!urls.length) return list;
    const found = new Map<string, { lat: number; lng: number } | null>();
    const token = await bearer();
    for (let i = 0; i < urls.length; i += 20) {
      const chunk = urls.slice(i, i + 20);
      setWorking(`Opening Google Maps links ${i + 1} to ${Math.min(i + 20, urls.length)} of ${urls.length}…`);
      try {
        const res = await fetch("/api/admin/locator/resolve-links", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ urls: chunk }),
        });
        const j = (await res.json().catch(() => ({}))) as { results?: ({ lat: number; lng: number } | null)[] };
        chunk.forEach((u, k) => found.set(u, j.results?.[k] ?? null));
      } catch {
        chunk.forEach((u) => found.set(u, null));
      }
    }
    return list.map((r) => {
      if (!r.needsResolve) return r;
      const hit = found.get(r.needsResolve);
      if (hit) return { ...r, needsResolve: null, payload: { ...r.payload, lat: hit.lat, lng: hit.lng } };
      return { ...r, warnings: [...r.warnings, "The Google Maps link could not be opened"] };
    });
  }

  async function runPreview(list: ParsedRow[]) {
    if (!supabase) return;
    setWorking("Checking every row…");
    const { data, error: e } = await supabase.rpc("locator_admin_vacc_import", { p_rows: list.map((r) => toRpcRow(r.payload)), p_commit: false, p_label: null });
    setWorking(null);
    if (e) return setError(/too_many_rows/.test(e.message) ? "A file can hold up to 1,000 centres at a time. Please split it into smaller files." : e.message);
    setPreview(data as ImportResult);
    setOnlyProblems(((data as ImportResult).counts.error || (data as ImportResult).counts.duplicate) > 0);
  }

  async function onFile(file: File | null) {
    setError(null);
    setNotice(null);
    setPreview(null);
    setDone(null);
    setSheet(null);
    setRows([]);
    if (!file) return;
    if (file.size > 6_000_000) return setError("That file is larger than 6 MB. Please split it into smaller files.");
    setFileName(file.name);
    setLabel(`${file.name.replace(/\.[^.]+$/, "")} · ${todayIso()}`);
    try {
      setWorking("Reading the file…");
      let table: unknown[][];
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        table = parseCsv(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        table = (await readSheet(file)) as unknown[][];
      } else {
        setWorking(null);
        return setError("Please upload an Excel file (.xlsx) or a CSV file. If your file is the older .xls type, open it in Excel and use Save As .xlsx.");
      }
      const parsed = parseTable(table);
      setSheet(parsed);
      if (parsed.missingRequired.length && !parsed.rows.length) {
        setWorking(null);
        return;
      }
      if (!parsed.rows.length) {
        setWorking(null);
        return setError("No centres found in that file below the header row.");
      }
      const resolved = await resolveLinks(parsed.rows);
      setRows(resolved);
      await runPreview(resolved);
    } catch (e) {
      setWorking(null);
      setError("That file could not be read: " + (e instanceof Error ? e.message : "unknown error") + ". Make sure it is a normal .xlsx or .csv file.");
    }
  }

  async function commit() {
    if (!supabase || !rows.length) return;
    if (!label.trim()) return setError("Please give this upload a name so you can find (and undo) it later.");
    setError(null);
    setWorking("Saving…");
    const { data, error: e } = await supabase.rpc("locator_admin_vacc_import", { p_rows: rows.map((r) => toRpcRow(r.payload)), p_commit: true, p_label: label.trim() });
    setWorking(null);
    if (e) return setError(e.message);
    setDone(data as ImportResult);
    setPreview(null);
    await load();
  }

  function downloadSkipped(res: ImportResult) {
    const bad = res.results.filter((r) => r.status === "error" || r.status === "duplicate");
    if (!bad.length) return;
    const keys = Array.from(new Set(bad.flatMap((b) => Object.keys(rows[b.row - 1]?.raw ?? {}))));
    const lines = [["sheet_row", ...keys, "problem"].map(csvCell).join(",")];
    for (const b of bad) {
      const r = rows[b.row - 1];
      lines.push([String(r?.line ?? ""), ...keys.map((k) => (r?.raw as Record<string, unknown>)?.[k] ?? ""), reasonText(b.reason)].map(csvCell).join(","));
    }
    download("vaccination-rows-to-fix.csv", lines.join("\n"));
  }

  function downloadTemplateCsv() {
    const head = ["centre_name", "district", "town", "uc", "address", "latitude", "longitude", "google_maps_link", "opening_time", "closing_time", "friday_opening_time", "friday_closing_time", "days_open", "vaccines_or_age_groups", "centre_phone", "centre_type", "source_note", "last_verified_date", "vaccines_offered", "service_fee"];
    const ex = ["Example row: delete me", "Karachi Central", "North Nazimabad", "Sir Syed-1", "Block B, near the main road", "24.9371", "67.0415", "", "09:00", "14:00", "09:00", "12:30", "Mon-Sat", "Routine EPI vaccines, 0 to 5 years", "", "Government health centre", "District health office list", todayIso(), "Government", ""];
    download("vaccination-centres-template.csv", [head, ex].map((l) => l.map(csvCell).join(",")).join("\n"));
  }

  async function undo(b: Batch) {
    if (!supabase) return;
    if (!window.confirm(`Undo "${b.label}"? The ${b.rows_added} centre(s) this upload added will be removed. Centres it only updated keep their new details.`)) return;
    const { data, error: e } = await supabase.rpc("locator_admin_vacc_undo", { p_batch: b.id });
    if (e) return setError(e.message);
    setNotice(`${data ?? 0} centre(s) removed.`);
    await load();
  }

  // ---------------------------------------------------------------- list
  const districts = useMemo(() => Array.from(new Set((centres ?? []).map((c) => c.district).filter((d): d is string => !!d))).sort(), [centres]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (centres ?? []).filter(
      (c) =>
        (district === "all" || c.district === district) &&
        (!t || [c.name, c.area, c.district, c.address].some((x) => (x ?? "").toLowerCase().includes(t)))
    );
  }, [centres, q, district]);

  const shownResults = useMemo(() => {
    if (!preview) return [];
    return preview.results.filter((r) => !onlyProblems || r.status === "error" || r.status === "duplicate" || (rows[r.row - 1]?.warnings.length ?? 0) > 0);
  }, [preview, onlyProblems, rows]);

  const tabs: { key: typeof view; label: string }[] = [
    { key: "add", label: editingId ? "Edit centre" : "Add one centre" },
    { key: "upload", label: "Upload a sheet (Excel / CSV)" },
    { key: "list", label: `All centres (${centres?.length ?? 0})` },
  ];

  return (
    <AdminGuard title="Vaccination centres">
      {() => (
        <div>
          <PageHeader title="Vaccination centres" subtitle="Free listing. Add one centre at a time, or upload a whole sheet for a district or for all of Sindh." />
          <div className="mx-auto max-w-4xl space-y-5 px-4 py-10 sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/admin/locator" className="text-sm font-medium text-teal-700 underline underline-offset-2">
                ← Back to Locator admin
              </Link>
              <Link href="/locator" target="_blank" className="text-sm font-medium text-teal-700 underline underline-offset-2">
                Open the public locator
              </Link>
              <button onClick={load} className="ml-auto text-sm font-medium text-teal-700 underline underline-offset-2">
                Refresh
              </button>
            </div>

            {error && (
              <p role="alert" data-testid="vacc-error" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" data-testid="vacc-notice" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                {notice}
              </p>
            )}

            <div className="flex flex-wrap gap-2 text-xs" role="tablist" aria-label="Vaccination sections">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={view === t.key}
                  onClick={() => setView(t.key)}
                  data-testid={`vacc-tab-${t.key}`}
                  className={`rounded-full px-3 py-1.5 font-medium ${view === t.key ? "bg-teal-700 text-white" : "bg-[#e6f1ed] text-ink-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ------------------------------------------------ add / edit one */}
            {view === "add" && (
              <form
                key={formKey}
                onSubmit={(e) => {
                  e.preventDefault();
                  saveOne();
                }}
                className={`${cardCls} space-y-4`}
                data-testid="vacc-form"
              >
                <p className="text-sm text-ink-700">
                  {editingId ? "Changing an existing centre. " : "A new centre goes live straight away: there is no payment or verification step. "}
                  Fields marked * are needed.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block font-semibold">Centre name *</span>
                    <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} data-testid="vacc-name" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">District</span>
                    <input className={inputCls} list="vacc-districts" value={form.district} onChange={(e) => set("district", e.target.value)} maxLength={60} placeholder="Karachi Central" data-testid="vacc-district" />
                    <datalist id="vacc-districts">
                      {DISTRICTS.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Town or UC (area) *</span>
                    <input className={inputCls} value={form.area} onChange={(e) => set("area", e.target.value)} maxLength={80} placeholder="North Nazimabad" data-testid="vacc-area" />
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block font-semibold">Address</span>
                    <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={240} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Centre phone (optional)</span>
                    <input className={inputCls} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Centre type (optional)</span>
                    <input className={inputCls} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={80} placeholder="Government health centre" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Vaccines offered *</span>
                    <select className={inputCls} value={form.vaccine_type} onChange={(e) => set("vaccine_type", e.target.value as VType)} data-testid="vacc-type">
                      <option value="government">Government vaccine</option>
                      <option value="private">Private vaccines only</option>
                      <option value="both">Both: government and private vaccines</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-semibold">
                    <input type="checkbox" checked={form.service_fee} onChange={(e) => set("service_fee", e.target.checked)} data-testid="vacc-fee" />
                    A small service fee may apply
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block font-semibold">Vaccines or age groups</span>
                    <input className={inputCls} value={form.vaccines} onChange={(e) => set("vaccines", e.target.value)} maxLength={300} placeholder="Routine EPI vaccines, 0 to 5 years" data-testid="vacc-vaccines" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Where this came from</span>
                    <input className={inputCls} value={form.source_note} onChange={(e) => set("source_note", e.target.value)} maxLength={200} placeholder="District health office list" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-semibold">Last checked on</span>
                    <input type="date" className={inputCls} value={form.last_verified} max={todayIso()} onChange={(e) => set("last_verified", e.target.value)} />
                    <span className="mt-1 block text-xs text-ink-500">Leave empty to use today.</span>
                  </label>
                </div>

                <div className="text-sm">
                  <span className="mb-1 block font-semibold">Opening and closing time, and days open</span>
                  <HoursEditor value={form.hours} onChange={(h) => set("hours", h)} idPrefix="vacc-hours" />
                </div>

                <div className="text-sm">
                  <span className="mb-1 block font-semibold">Pin *: paste any Google Maps link (the short Share link works too), or use GPS when you are at the centre</span>
                  <LocationPicker
                    value={form.lat !== "" && form.lng !== "" && Number.isFinite(Number(form.lat)) && Number.isFinite(Number(form.lng)) ? { lat: Number(form.lat), lng: Number(form.lng) } : null}
                    onPick={(c) => setForm((f) => ({ ...f, lat: String(c.lat), lng: String(c.lng) }))}
                    ids={{ gps: "vacc-gps", paste: "vacc-link", ok: "vacc-pin-ok" }}
                    gpsLabel="Use my GPS (I am at the centre)"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label>
                      <span className="mb-1 block text-xs font-semibold">Latitude</span>
                      <input className={inputCls} inputMode="decimal" value={form.lat} onChange={(e) => set("lat", e.target.value)} data-testid="vacc-lat" />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-semibold">Longitude</span>
                      <input className={inputCls} inputMode="decimal" value={form.lng} onChange={(e) => set("lng", e.target.value)} data-testid="vacc-lng" />
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="submit" disabled={saving} className={btnPrimary} data-testid="vacc-save">
                    {saving ? "Saving…" : editingId ? "Save changes" : "Add this centre"}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        setEditingId(null);
                        setForm(EMPTY);
                        setFormKey((k) => k + 1);
                      }}
                    >
                      Cancel editing
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* ------------------------------------------------ upload */}
            {view === "upload" && (
              <div className="space-y-4">
                <div className={`${cardCls} space-y-3 text-sm text-ink-700`}>
                  <p className="font-bold text-ink-900">Upload many centres at once</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      Use the template (one row per centre). Your own sheet also works: headers such as centre name, district, town, UC, latitude, longitude, Google Maps link, opening and closing time (Friday can have its own times), days open and vaccines are
                      recognised automatically.
                    </li>
                    <li>Choose the file. Every row is checked first and nothing is saved yet.</li>
                    <li>Read the summary, then press Save. Each upload gets a name, so a mistaken upload can be undone later.</li>
                  </ol>
                  <p>
                    Each centre needs a name, a town, UC or district, and a location (latitude and longitude, or a Google Maps link). Opening hours are optional. Uploading a centre again updates it instead of adding a copy.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <a href="/templates/vaccination-centres-template.xlsx" download className={btnGhost} data-testid="vacc-template-xlsx">
                      Download Excel template
                    </a>
                    <button type="button" onClick={downloadTemplateCsv} className={btnGhost}>
                      Download CSV template
                    </button>
                  </div>
                </div>

                <div className={cardCls}>
                  <label className="block text-sm font-semibold">
                    Choose an Excel (.xlsx) or CSV file
                    <input
                      type="file"
                      accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="mt-2 block w-full text-sm"
                      data-testid="vacc-file"
                      disabled={!!working}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        onFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {working && (
                    <p className="mt-3 text-sm text-ink-700" data-testid="vacc-working">
                      {working}
                    </p>
                  )}
                </div>

                {sheet && (
                  <div className={`${cardCls} space-y-2 text-sm`}>
                    <p className="font-bold text-ink-900">{fileName}</p>
                    {sheet.missingRequired.map((m) => (
                      <p key={m} className="rounded-lg bg-amber-50 p-2 text-amber-900">
                        {m}
                      </p>
                    ))}
                    {sheet.matched.length > 0 && <p className="text-ink-700">Columns recognised: {sheet.matched.map((m) => FIELD_WORDS[m] ?? m).join(", ")}.</p>}
                    {sheet.unmatchedHeaders.length > 0 && <p className="text-ink-500">Columns ignored: {sheet.unmatchedHeaders.join(", ")}.</p>}
                    {sheet.vtypeDefaulted && (
                      <p className="rounded-lg bg-sky-50 p-2 text-sky-900" data-testid="vacc-vtype-default">
                        This file has no &quot;vaccines offered&quot; column, so every row is treated as a government vaccine centre.
                      </p>
                    )}
                    {!sheet.vtypeDefaulted && sheet.rows.some((r) => r.payload.vaccine_type === "private" || r.payload.vaccine_type === "both") && (
                      <p className="text-ink-700" data-testid="vacc-vtype-count">
                        Centres offering private vaccines in this file: {sheet.rows.filter((r) => r.payload.vaccine_type === "private" || r.payload.vaccine_type === "both").length}.
                      </p>
                    )}
                  </div>
                )}

                {preview && (
                  <div className={`${cardCls} space-y-3`} data-testid="vacc-preview">
                    <p className="font-bold text-ink-900">Check before saving</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["New centres", preview.counts.new, "text-emerald-700"],
                        ["Will be updated", preview.counts.update, "text-sky-700"],
                        ["Skipped: need fixing", preview.counts.error, "text-red-700"],
                        ["Skipped: repeated in file", preview.counts.duplicate, "text-amber-700"],
                      ].map(([l, n, c]) => (
                        <div key={String(l)} className="rounded-xl border border-[#e3eeea] p-3">
                          <div className={`text-xl font-extrabold ${c}`}>{n}</div>
                          <div className="text-xs font-semibold text-ink-500">{l}</div>
                        </div>
                      ))}
                    </div>
                    {(preview.counts.error > 0 || preview.counts.duplicate > 0) && (
                      <p className="text-sm text-ink-700">
                        Skipped rows are not saved. You can still save the good rows now, then download the skipped ones, fix them (usually the location) and upload that file again.
                      </p>
                    )}

                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                      Show only rows with a problem or a warning
                    </label>
                    <div className="max-h-96 overflow-auto rounded-xl border border-[#e3eeea]">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-[#f2f8f6] text-ink-500">
                          <tr>
                            <th className="px-2 py-1.5">Row</th>
                            <th className="px-2 py-1.5">Centre</th>
                            <th className="px-2 py-1.5">Result</th>
                            <th className="px-2 py-1.5">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownResults.slice(0, 300).map((r) => {
                            const pr = rows[r.row - 1];
                            const bad = r.status === "error" || r.status === "duplicate";
                            return (
                              <tr key={r.row} className="border-t border-[#e8f1ee] align-top">
                                <td className="px-2 py-1.5">{pr?.line ?? r.row}</td>
                                <td className="px-2 py-1.5 font-semibold text-ink-900">{r.name || "(no name)"}</td>
                                <td className={`px-2 py-1.5 font-semibold ${bad ? "text-red-700" : r.status === "update" ? "text-sky-700" : "text-emerald-700"}`}>
                                  {r.status === "new" ? "New" : r.status === "update" ? "Update" : r.status === "duplicate" ? "Repeated" : "Skipped"}
                                </td>
                                <td className="px-2 py-1.5 text-ink-700">{[reasonText(r.reason), ...(pr?.warnings ?? [])].filter(Boolean).join(". ")}</td>
                              </tr>
                            );
                          })}
                          {shownResults.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-2 py-3 text-ink-500">
                                No problems found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {shownResults.length > 300 && <p className="text-xs text-ink-500">Showing the first 300 rows of {shownResults.length}.</p>}

                    <label className="block text-sm">
                      <span className="mb-1 block font-semibold">Name for this upload (so you can undo it later)</span>
                      <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} data-testid="vacc-label" />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button className={btnPrimary} onClick={commit} disabled={!!working || preview.counts.new + preview.counts.update === 0} data-testid="vacc-commit">
                        Save {preview.counts.new + preview.counts.update} centre(s)
                      </button>
                      {(preview.counts.error > 0 || preview.counts.duplicate > 0) && (
                        <button className={btnGhost} onClick={() => downloadSkipped(preview)}>
                          Download skipped rows
                        </button>
                      )}
                      <button
                        className={btnGhost}
                        onClick={() => {
                          setPreview(null);
                          setSheet(null);
                          setRows([]);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {done && (
                  <div className={`${cardCls} space-y-2 text-sm`} data-testid="vacc-done">
                    <p className="font-bold text-emerald-800">Saved. These centres are live in the Locator now.</p>
                    <p className="text-ink-700">
                      {done.counts.new} added, {done.counts.update} updated, {done.counts.error + done.counts.duplicate} skipped.
                    </p>
                    {done.counts.error + done.counts.duplicate > 0 && (
                      <button className={btnGhost} onClick={() => downloadSkipped(done)}>
                        Download skipped rows to fix
                      </button>
                    )}
                  </div>
                )}

                {batches.length > 0 && (
                  <div className={`${cardCls} space-y-2 text-sm`}>
                    <p className="font-bold text-ink-900">Past uploads</p>
                    <p className="text-xs text-ink-500">Undo removes only the centres that upload added. Centres it merely updated keep their new details.</p>
                    {batches.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-center gap-3 border-t border-[#e8f1ee] pt-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-ink-900">{b.label}</p>
                          <p className="text-xs text-ink-500">
                            {new Date(b.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {b.rows_added} added · {b.rows_updated} updated · {b.rows_skipped} skipped
                          </p>
                        </div>
                        <button className={btnGhost} onClick={() => undo(b)} disabled={b.rows_added === 0}>
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ------------------------------------------------ list */}
            {view === "list" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    className={`${inputCls} sm:max-w-xs`}
                    placeholder="Search name, area or address"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setShown(100);
                    }}
                    data-testid="vacc-search"
                  />
                  <select className={`${inputCls} sm:max-w-[14rem]`} value={district} onChange={(e) => { setDistrict(e.target.value); setShown(100); }} aria-label="District">
                    <option value="all">All districts</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <p className="self-center text-xs text-ink-500">{filtered.length} centre(s)</p>
                </div>
                {centres === null && <p className="text-sm text-ink-500">Loading…</p>}
                {centres !== null && filtered.length === 0 && <p className="text-sm text-ink-500">No centres yet. Add one or upload a sheet.</p>}
                {filtered.slice(0, shown).map((c) => {
                  const age = ageDays(c.last_verified);
                  return (
                    <div key={c.id} className={`${cardCls} text-sm`} data-testid="vacc-row">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-extrabold text-ink-900">
                            {c.name} {c.status === "hidden" && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Hidden</span>}
                          </p>
                          <p className="text-ink-700">{[c.area, c.district].filter(Boolean).join(" · ")}</p>
                          <p className="text-xs text-ink-500">
                            {VTYPE_LABEL[c.vaccine_type ?? "government"]}
                            {c.service_fee ? " · service fee may apply" : ""} · {hoursSummary(c.hours) ?? "No hours given"}
                            {c.vaccines ? ` · ${c.vaccines}` : ""}
                          </p>
                          <p className={`text-xs ${age !== null && age > 180 ? "font-semibold text-amber-700" : "text-ink-500"}`}>
                            {c.last_verified ? `Checked ${c.last_verified}${age !== null && age > 180 ? " (over 6 months ago: worth re-checking)" : ""}` : "Not checked yet"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className={btnGhost} onClick={() => startEdit(c)}>
                            Edit
                          </button>
                          <button className={btnGhost} onClick={() => setStatus(c, c.status === "hidden" ? "approved" : "hidden")}>
                            {c.status === "hidden" ? "Show" : "Hide"}
                          </button>
                          <button className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => remove(c)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filtered.length > shown && (
                  <button className={btnGhost} onClick={() => setShown((n) => n + 200)}>
                    Show more ({filtered.length - shown} left)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}
