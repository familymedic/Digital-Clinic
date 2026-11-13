"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PosterMaker from "@/components/locator/PosterMaker";
import LocationPicker from "@/components/locator/LocationPicker";
import HoursEditor from "@/components/locator/HoursEditor";
import { CATEGORY_LABEL, ALL_AREAS, KINDS, SERVICE_AREA_TEXT, cleanHours, inPilot, kindLabel, type LocatorCategory, type OpenHours } from "@/lib/locator";
import { fmtDate, rs, waNumber, type Fee, type Place } from "./types";

// Admin "Add a place". Many owners contact you directly, so this takes everything in one go:
// the place, the owner, whether you have checked the documents, and (optionally) the payment
// you received, then hands back the receipt number and the owner's private link. The phone
// code is not needed here: you are the verification.

const inputCls = "w-full rounded-xl border border-[#cfe0da] bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-teal-600";

const empty = {
  id: "",
  category: "doctor" as LocatorCategory,
  kind: "clinic",
  name: "",
  area: "",
  address: "",
  phone: "",
  notes: "",
  link: "",
  lat: "",
  lng: "",
  hours: null as OpenHours | null,
  doctor_id: "",
  orientation_date: "",
  owner_name: "",
  owner_phone: "",
  owner_email: "",
  phone_confirmed: true,
  registration: "",
  verification: "verified" as "verified" | "not_required" | "pending",
  takePayment: true,
  amount: "",
  method: "cash",
  months: "12",
  reference: "",
};

type FormState = typeof empty;

interface Result {
  name: string;
  kindText: string;
  area: string;
  verified: boolean;
  receipt: { no: number; until: string; amount: number; method: string } | null;
  link: string | null;
  ownerName: string;
  ownerPhone: string;
}

export function formFromPlace(p: Place): FormState {
  return {
    ...empty,
    id: p.id,
    category: p.category,
    kind: p.kind,
    name: p.name,
    area: p.area,
    address: p.address ?? "",
    phone: p.phone ?? "",
    notes: p.notes ?? "",
    lat: String(p.lat),
    lng: String(p.lng),
    hours: p.hours ?? null,
    doctor_id: p.doctor_id ?? "",
    orientation_date: p.orientation_date ?? "",
    owner_name: p.owner_name ?? "",
    owner_phone: p.owner_phone ?? "",
    owner_email: p.owner_email ?? "",
    phone_confirmed: p.phone_verified,
    registration: p.registration_numbers ?? "",
    takePayment: false,
  };
}

export default function PlaceForm(props: {
  fees: Fee[];
  initial: FormState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(props.initial ?? empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const editing = Boolean(form.id);
  const paidKind = form.category !== "autism";
  const fee = props.fees.find((f) => f.kind === form.kind);
  const amount = form.amount !== "" ? form.amount : String(fee?.fee_pkr ?? 1000);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function changeCategory(c: LocatorCategory) {
    const k = KINDS[c][0].value;
    const f = props.fees.find((x) => x.kind === k);
    setForm((cur) => ({
      ...cur,
      category: c,
      kind: k,
      amount: "",
      verification: c === "autism" ? "not_required" : f && !f.requires_verification ? "not_required" : "verified",
      takePayment: c !== "autism",
    }));
  }

  function changeKind(k: string) {
    const f = props.fees.find((x) => x.kind === k);
    setForm((cur) => ({ ...cur, kind: k, amount: "", verification: f && !f.requires_verification ? "not_required" : cur.verification === "not_required" && paidKind ? "verified" : cur.verification }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (form.lat.trim() === "" || form.lng.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMsg("The pin is not set yet. Press \"Use my GPS\" or paste a Google Maps link (a short Share link works) in the pin box above, then save again.");
      return;
    }
    if (!inPilot(lat, lng)) {
      setMsg(`This pin (${lat}, ${lng}) is outside our service areas (${SERVICE_AREA_TEXT}), so check the link or the numbers.`);
      return;
    }
    if (form.doctor_id && !/^[0-9a-f-]{36}$/i.test(form.doctor_id.trim())) {
      setMsg("The Family Medic doctor id must be the long id from the doctor's page address, or leave it empty.");
      return;
    }
    if (form.takePayment && !editing && paidKind && (!Number.isFinite(Number(amount)) || (Number(amount) <= 0 && form.method !== "complimentary"))) {
      setMsg("Enter the amount received (or choose Complimentary for a free listing).");
      return;
    }
    const row = {
      category: form.category,
      kind: form.kind,
      name: form.name.trim(),
      area: form.area.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      hours: cleanHours(form.hours),
      doctor_id: form.doctor_id.trim() || null,
      orientation_date: form.category === "autism" && form.orientation_date ? form.orientation_date : null,
      owner_name: form.owner_name.trim() || null,
      owner_phone: form.owner_phone.trim() || null,
      owner_email: form.owner_email.trim() || null,
      phone_verified: form.owner_phone.trim() ? form.phone_confirmed : false,
      registration_numbers: form.registration.trim() || null,
    };
    setBusy(true);
    setMsg(null);

    if (editing) {
      const { error } = await supabase.from("locator_places").update(row).eq("id", form.id);
      setBusy(false);
      if (error) return setMsg(error.message);
      props.onSaved();
      props.onClose();
      return;
    }

    const ins = await supabase
      .from("locator_places")
      .insert({
        ...row,
        status: "approved",
        source: "admin",
        consent_confirmed: true,
        reviewed_at: new Date().toISOString(),
        verification_status: paidKind ? form.verification : "not_required",
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      setBusy(false);
      return setMsg(ins.error?.message ?? "Could not save.");
    }
    const placeId = ins.data.id as string;

    let receipt: Result["receipt"] = null;
    if (paidKind && form.takePayment) {
      const pay = await supabase.rpc("locator_admin_record_payment", {
        p_place: placeId,
        p_amount: Math.round(Number(amount)),
        p_method: form.method,
        p_reference: form.reference,
        p_note: null,
        p_months: Math.round(Number(form.months)),
      });
      if (pay.error) {
        setBusy(false);
        props.onSaved();
        return setMsg(`The place was added, but the payment was not recorded (${pay.error.message}). Find it under Live or Awaiting payment and record it there.`);
      }
      const r = pay.data as { receipt_no: number; paid_until: string };
      receipt = { no: r.receipt_no, until: r.paid_until, amount: Math.round(Number(amount)), method: form.method };
    }

    let link: string | null = null;
    if (paidKind) {
      const lk = await supabase.rpc("locator_admin_make_link", { p_place: placeId });
      if (!lk.error && lk.data) link = `${window.location.origin}/locator/manage/${lk.data as string}`;
    }
    setBusy(false);
    props.onSaved();
    setResult({
      name: row.name,
      kindText: kindLabel(row.kind),
      area: row.area,
      verified: form.verification === "verified",
      receipt,
      link,
      ownerName: form.owner_name,
      ownerPhone: form.owner_phone,
    });
  }

  if (result) {
    const wa = result.ownerPhone ? waNumber(result.ownerPhone) : null;
    const text = encodeURIComponent(
      `Assalam o Alaikum ${result.ownerName}, ${result.name} is now set up on the Family Medic Locator${result.receipt ? ` (receipt no. ${result.receipt.no}, live until ${fmtDate(result.receipt.until)})` : ""}. ${result.link ? "Your private page, with your status and renewal: " + result.link : ""}`
    );
    return (
      <div className="space-y-3 rounded-3xl border border-[#d7e7e2] bg-white p-5" data-testid="admin-add-result">
        <p className="text-sm font-extrabold text-ink-900">Added: {result.name}</p>
        {result.receipt ? (
          <p className="rounded-xl bg-[#fff8ec] p-3 text-sm text-ink-800">
            Payment recorded: <strong>{rs(result.receipt.amount)}</strong> ({result.receipt.method}) · <strong>Receipt no. {result.receipt.no}</strong> · live until{" "}
            {fmtDate(result.receipt.until)}
          </p>
        ) : (
          paidKind && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No payment recorded yet: it will not show to the public until paid. Use &quot;Record payment&quot; on its card.</p>
        )}
        {result.link && (
          <div className="space-y-2 text-xs">
            <p className="font-bold text-ink-900">Private link for the owner</p>
            <p className="break-all rounded-xl bg-[#f3f9f7] p-2 font-mono">{result.link}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigator.clipboard?.writeText(result.link as string)} className="rounded-full border border-teal-700 px-3.5 py-1.5 font-bold text-teal-800">
                Copy link
              </button>
              {wa && (
                <a href={`https://wa.me/${wa}?text=${text}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-teal-700 px-3.5 py-1.5 font-bold text-white">
                  Send on WhatsApp
                </a>
              )}
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-bold text-ink-900">Poster to hand over or post</p>
          <PosterMaker name={result.name} kindLabel={result.kindText} area={result.area} verified={result.verified} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setResult(null)} className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white">
            Add another
          </button>
          <button onClick={props.onClose} className="rounded-full border border-[#cfe0da] px-5 py-2.5 text-sm font-bold text-ink-700">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-3xl border border-[#d7e7e2] bg-white p-5" data-testid="admin-place-form">
      <p className="text-sm font-extrabold text-ink-900">{editing ? "Edit place" : "Add a place directly (goes live once paid, or straight away if free)"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">List</span>
          <select value={form.category} onChange={(e) => changeCategory(e.target.value as LocatorCategory)} className={inputCls} data-testid="admin-form-category">
            <option value="doctor">{CATEGORY_LABEL.doctor}</option>
            <option value="pharmacy">{CATEGORY_LABEL.pharmacy}</option>
            <option value="therapy">{CATEGORY_LABEL.therapy}</option>
            <option value="autism">{CATEGORY_LABEL.autism}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Type</span>
          <select value={form.kind} onChange={(e) => changeKind(e.target.value)} className={inputCls} data-testid="admin-form-kind">
            {KINDS[form.category].map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Name</span>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={inputCls} data-testid="admin-form-name" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Area</span>
          <input required list="admin-areas" value={form.area} onChange={(e) => set("area", e.target.value)} maxLength={80} className={inputCls} data-testid="admin-form-area" />
          <datalist id="admin-areas">
            {ALL_AREAS.map((a) => (
              <option key={a.name} value={a.name} />
            ))}
          </datalist>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Phone (public, optional)</span>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Address (optional)</span>
          <input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={240} className={inputCls} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Note shown to families (optional)</span>
        <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={400} rows={2} className={inputCls} />
      </label>
      <div className="text-sm">
        <span className="mb-1 block font-semibold">Opening hours (optional)</span>
        <HoursEditor value={form.hours} onChange={(h) => set("hours", h)} idPrefix="admin-hours" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="text-sm sm:col-span-3">
          <span className="mb-1 block font-semibold">Pin: paste any Google Maps link (the short Share link works too), or use GPS when you are at the place</span>
          <LocationPicker
            value={Number.isFinite(Number(form.lat)) && Number.isFinite(Number(form.lng)) && form.lat !== "" && form.lng !== "" ? { lat: Number(form.lat), lng: Number(form.lng) } : null}
            onPick={(c) => setForm((f) => ({ ...f, lat: String(c.lat), lng: String(c.lng) }))}
            ids={{ gps: "admin-form-gps", paste: "admin-form-link", ok: "admin-form-pin-ok" }}
            gpsLabel="Use my GPS (I am at the place)"
          />
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Latitude</span>
          <input required value={form.lat} onChange={(e) => set("lat", e.target.value)} inputMode="decimal" className={inputCls} data-testid="admin-form-lat" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Longitude</span>
          <input required value={form.lng} onChange={(e) => set("lng", e.target.value)} inputMode="decimal" className={inputCls} data-testid="admin-form-lng" />
        </label>
        {form.category === "autism" && (
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Orientation date</span>
            <input type="date" value={form.orientation_date} onChange={(e) => set("orientation_date", e.target.value)} className={inputCls} />
          </label>
        )}
        {form.category === "doctor" && (
          <label className="text-sm sm:col-span-3">
            <span className="mb-1 block font-semibold">Family Medic doctor id (optional, adds a &quot;Book online&quot; button)</span>
            <input value={form.doctor_id} onChange={(e) => set("doctor_id", e.target.value)} placeholder="the long id in the doctor's page address after /doctors/" className={inputCls} />
          </label>
        )}
      </div>

      {paidKind && (
        <div className="space-y-3 rounded-2xl bg-[#f3f9f7] p-4">
          <p className="text-xs font-extrabold tracking-[0.14em] text-teal-700">OWNER</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Owner name</span>
              <input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} maxLength={80} className={inputCls} data-testid="admin-form-owner-name" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Owner mobile</span>
              <input value={form.owner_phone} onChange={(e) => set("owner_phone", e.target.value)} maxLength={30} inputMode="tel" className={inputCls} data-testid="admin-form-owner-phone" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Owner email</span>
              <input value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} maxLength={120} className={inputCls} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.phone_confirmed} onChange={(e) => set("phone_confirmed", e.target.checked)} />
            I have confirmed this number myself (no phone code needed for admin entries)
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Registration / licence numbers you saw (optional)</span>
            <input value={form.registration} onChange={(e) => set("registration", e.target.value)} maxLength={300} className={inputCls} />
          </label>
          {!editing && (
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Documents</span>
              <select value={form.verification} onChange={(e) => set("verification", e.target.value as FormState["verification"])} className={inputCls} data-testid="admin-form-verification">
                <option value="verified">I have checked the documents: show as verified</option>
                <option value="not_required">No check needed (e.g. pharmacy): show as listed</option>
                <option value="pending">I will check them later: keep as pending</option>
              </select>
            </label>
          )}
        </div>
      )}

      {paidKind && !editing && (
        <div className="space-y-3 rounded-2xl bg-[#fff8ec] p-4">
          <label className="flex items-center gap-2 text-sm font-bold text-ink-900">
            <input type="checkbox" checked={form.takePayment} onChange={(e) => set("takePayment", e.target.checked)} data-testid="admin-form-take-payment" />
            I received payment: record it now and give a receipt number
          </label>
          {form.takePayment && (
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="text-xs font-semibold">
                Amount (PKR)
                <input value={amount} onChange={(e) => set("amount", e.target.value)} inputMode="numeric" className={inputCls} data-testid="admin-form-amount" />
              </label>
              <label className="text-xs font-semibold">
                Method
                <select value={form.method} onChange={(e) => set("method", e.target.value)} className={inputCls}>
                  <option value="cash">Cash</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="bank">Bank transfer</option>
                  <option value="complimentary">Complimentary (free)</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-xs font-semibold">
                Months
                <input value={form.months} onChange={(e) => set("months", e.target.value)} inputMode="numeric" className={inputCls} />
              </label>
              <label className="text-xs font-semibold">
                Reference
                <input value={form.reference} onChange={(e) => set("reference", e.target.value)} maxLength={120} placeholder="txn id / note" className={inputCls} />
              </label>
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm font-semibold text-red-700">{msg}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} data-testid="admin-form-submit" className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60">
          {busy ? "Saving…" : editing ? "Save changes" : "Add place"}
        </button>
        <button type="button" onClick={props.onClose} className="rounded-full border border-[#cfe0da] px-5 py-2.5 text-sm font-bold text-ink-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
