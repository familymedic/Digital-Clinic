"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import LocationPicker from "@/components/locator/LocationPicker";
import HoursEditor, { hoursForSave } from "@/components/locator/HoursEditor";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { KARACHI_AREAS, hoursLines, hoursStatus, type OpenHours } from "@/lib/locator";

// "My clinic" (Locator, migration 0097). A registered doctor who has paid their access fee adds
// their own clinic to the Family Medic Locator: name, area, address, phone, pin, opening hours.
// It goes live at once (Family Medic has already verified the doctor), is linked to the doctor's
// page so families get a "Book online" button, and is free for 12 months from the doctor's first
// clinic listing. After that the normal annual fee is paid here through Safepay. Only ONE clinic
// per doctor is covered by the access fee; every further clinic pays the clinic fee from the start. The rules are
// enforced in the database (locator_doctor_* functions), not only on this screen.

interface Status {
  doctor: boolean;
  eligible?: boolean;
  reason?: "not_approved" | "unpaid" | null;
  full_name?: string;
  active_places?: number;
  max_places?: number;
  fee_pkr?: number;
  free_until?: string | null;
  free_available?: boolean;
}
interface MyPlace {
  id: string;
  name: string;
  area: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  lat: number;
  lng: number;
  hours: OpenHours | null;
  status: string;
  paid_until: string | null;
  free?: boolean;
  live: boolean;
}

const CARD = "rounded-[26px] bg-white p-5 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-6";
const BTN =
  "rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-[#b9d3cd]";
const inputCls = "w-full rounded-xl border border-[#d7e7e2] bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-teal-600";
const labelCls = "mb-1 block text-sm font-bold text-ink-900";

const ERRORS: Record<string, string> = {
  not_eligible: "Your doctor access is not active, so a clinic cannot be added right now.",
  bad_name: "Please enter the clinic name.",
  bad_area: "Please choose the area.",
  bad_hours: "The opening hours do not look right. Please check the times.",
  outside_pilot: "That pin is outside Karachi. The pilot is Karachi only for now.",
  duplicate: "A clinic with this name is already listed at this spot. If it is yours, please contact us.",
  limit_reached: "You have reached the maximum number of clinics. Remove one first, or contact us.",
  consent_required: "Please tick the box to confirm this is your clinic.",
  not_found: "That clinic could not be found.",
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const bareName = (n: string) => n.trim().replace(/^(?:(?:dr|doctor)(?:\.\s*|\s+))+/i, "").trim() || n.trim();

interface FormState {
  id: string | null;
  name: string;
  area: string;
  address: string;
  phone: string;
  notes: string;
  pin: { lat: number; lng: number } | null;
  hours: OpenHours | null;
  consent: boolean;
}

export default function DoctorClinicPage() {
  const { profile, profileChecking, authLoading, signOut } = useDoctorProfileWithSignOut();
  const [status, setStatus] = useState<Status | null>(null);
  const [nowMs] = useState(() => Date.now());
  const [places, setPlaces] = useState<MyPlace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [payBusy, setPayBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const st = await supabase.rpc("locator_doctor_status");
    if (st.error || !st.data) {
      setStatus({ doctor: false });
      setLoaded(true);
      return;
    }
    setStatus(st.data as Status);
    const pl = await supabase.rpc("locator_doctor_my_places");
    setPlaces(pl.error ? [] : ((pl.data ?? []) as MyPlace[]).map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) })));
    setLoaded(true);
  }, []);

  const doctorId = profile?.id;
  useEffect(() => {
    if (!doctorId) return;
    Promise.resolve().then(load);
  }, [doctorId, load]);

  function newForm(): FormState {
    return {
      id: null,
      name: `Dr. ${bareName(profile?.full_name ?? "")} Clinic`.replace("Dr.  Clinic", "My Clinic"),
      area: "",
      address: "",
      phone: "",
      notes: "",
      pin: null,
      hours: null,
      consent: false,
    };
  }
  function editForm(p: MyPlace): FormState {
    return { id: p.id, name: p.name, area: p.area, address: p.address ?? "", phone: p.phone ?? "", notes: p.notes ?? "", pin: { lat: p.lat, lng: p.lng }, hours: p.hours, consent: true };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !form) return;
    if (!form.pin) return setMsg({ ok: false, text: "Please set the pin of your clinic (GPS or a Google Maps link)." });
    if (!form.area) return setMsg({ ok: false, text: "Please choose the area." });
    if (!form.consent) return setMsg({ ok: false, text: ERRORS.consent_required });
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("locator_doctor_save_place", {
      p_id: form.id,
      p_name: form.name,
      p_area: form.area,
      p_address: form.address || null,
      p_phone: form.phone || null,
      p_notes: form.notes || null,
      p_lat: form.pin.lat,
      p_lng: form.pin.lng,
      p_hours: hoursForSave(form.hours),
      p_consent: form.consent,
    });
    setBusy(false);
    if (error) {
      const code = Object.keys(ERRORS).find((k) => String(error.message).includes(k));
      setMsg({ ok: false, text: code ? ERRORS[code] : "Could not save. Please try again." });
      return;
    }
    const r = data as { created?: boolean; paid_until?: string | null };
    setForm(null);
    setMsg({
      ok: true,
      text: r.created
        ? r.paid_until
          ? `Your clinic is live on the Family Medic Locator, free until ${fmtDate(r.paid_until)}.`
          : `Your clinic was added but is not live yet. Pay the clinic fee (${feeText}) with the button on its card and it goes live for 12 months.`
        : "Saved.",
    });
    await load();
  }

  async function remove(p: MyPlace) {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`Remove ${p.name} from the Locator? Families will no longer see it.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("locator_doctor_remove_place", { p_id: p.id });
    setBusy(false);
    setMsg(error ? { ok: false, text: "Could not remove it. Please try again." } : { ok: true, text: "Removed from the Locator." });
    await load();
  }

  async function renew(p: MyPlace) {
    if (!supabase) return;
    setPayBusy(p.id);
    setMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/doctor/locator/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ placeId: p.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; error?: string };
      if (j.ok && j.checkoutUrl) {
        window.location.href = j.checkoutUrl;
        return;
      }
      setMsg({
        ok: false,
        text:
          j.error === "payments_unavailable"
            ? "Online payment is not available right now. Please contact us and we will take payment another way."
            : j.error === "not_due_yet"
              ? "Renewal opens 60 days before your listing ends."
              : "Could not start the payment. Please try again in a minute.",
      });
    } catch {
      setMsg({ ok: false, text: "Could not start the payment. Please try again in a minute." });
    }
    setPayBusy(null);
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="dashboard">
        <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking || !loaded) {
    return (
      <DoctorShell active="dashboard">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell active="dashboard" onSignOut={signOut}>
        <p className="text-sm text-ink-700">
          This page is for approved doctor accounts. <Link href="/doctor/login" className="font-semibold text-teal-700 underline">Doctor log in</Link>
        </p>
      </DoctorShell>
    );
  }

  const st = status ?? { doctor: false };
  const max = st.max_places ?? 10;
  const canAdd = Boolean(st.eligible) && (st.active_places ?? 0) < max;
  const feeText = st.fee_pkr ? `PKR ${st.fee_pkr.toLocaleString("en-PK")}` : "the annual fee";
  const freeAvailable = Boolean(st.free_available);
  const freeHeld = places.find((q) => q.free);

  return (
    <DoctorShell active="dashboard" doctorName={profile.full_name} onSignOut={signOut} doctorId={profile.id}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">My clinic on the Locator</h1>
      <p className="mt-1.5 text-sm text-ink-700">
        Families near you search the Family Medic Locator for clinics. Add your clinic with its pin and opening hours, and they get Directions, Call
        and a Book online button that goes to your page.
      </p>

      {!st.eligible && (
        <div className={`${CARD} mt-5 border border-amber-200 bg-amber-50`} data-testid="clinic-not-eligible">
          <p className="text-sm font-bold text-amber-900">
            {st.reason === "unpaid" ? "Your one-time registration fee (PKR 2,500) is not paid yet." : "Your doctor account is not active yet."}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {st.reason === "unpaid"
              ? "Once it is paid, you can add your clinic here and it is free for your first year."
              : "You can add your clinic once your account is approved and active."}{" "}
            <Link href="/doctor" className="font-bold underline">Go to the dashboard</Link>
          </p>
        </div>
      )}

      {st.eligible && (
        <div className={`${CARD} mt-5 border border-teal-100 bg-[#f3f9f7]`} data-testid="clinic-offer">
          <p className="text-sm text-ink-800">
            {freeAvailable ? (
              <>
                <b>Your first clinic is free for its first year.</b> Because you have paid your registration fee, one clinic is free for 12 months from the day you add it.
                After that its annual fee is {feeText}. Any further clinic costs {feeText} a year, paid here by Safepay.
              </>
            ) : freeHeld && freeHeld.paid_until && new Date(freeHeld.paid_until) > new Date() ? (
              <>
                <b>Your first clinic is free until {fmtDate(freeHeld.paid_until)}.</b> After that its annual fee is {feeText}. Each further clinic costs {feeText} a year,
                paid here by Safepay.
              </>
            ) : (
              <>Your free clinic year is over. Each clinic costs {feeText} a year, paid here by Safepay.</>
            )}
          </p>
        </div>
      )}

      {msg && (
        <p role="status" data-testid="clinic-msg" className={`mt-4 rounded-xl p-3 text-sm ${msg.ok ? "bg-teal-50 text-teal-900" : "bg-red-50 text-red-800"}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-5 space-y-4">
        {places.map((p) => {
          const hs = hoursStatus(p.hours);
          const renewable = p.paid_until === null || new Date(p.paid_until).getTime() < nowMs + 60 * 86400000;
          return (
            <div key={p.id} className={CARD} data-testid="clinic-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-ink-900">{p.name}</h2>
                  <p className="text-sm text-ink-500">{p.area}{p.address ? ` · ${p.address}` : ""}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${p.live ? "bg-[#e1f5e6] text-[#1d6b34]" : "bg-amber-100 text-amber-900"}`}>
                  {p.live ? "Live on the Locator" : p.paid_until ? "Not live: fee due" : "Not live yet: fee to pay"}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-700">
                {p.paid_until ? `${p.live ? "Live" : "Was live"} until ${fmtDate(p.paid_until)}.` : `Families cannot see it until the clinic fee (${feeText}) is paid.`}{p.free && p.live ? " This is your free clinic." : ""}{" "}
                {hs ? `Hours: ${hs.text}.` : "No opening hours set."}
              </p>
              {p.hours && hoursLines(p.hours).length > 1 && (
                <details className="mt-1 text-xs text-ink-700">
                  <summary className="cursor-pointer font-bold text-teal-800">All hours</summary>
                  <ul className="mt-1 space-y-0.5">
                    {hoursLines(p.hours).map((l) => (
                      <li key={l.day}><b>{l.day}:</b> {l.text}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={BTN} onClick={() => { setMsg(null); setForm(editForm(p)); }} data-testid="clinic-edit">
                  Edit details and hours
                </button>
                {renewable && (
                  <button
                    type="button"
                    disabled={payBusy === p.id}
                    onClick={() => renew(p)}
                    data-testid="clinic-renew"
                    className="rounded-full bg-[#ffb454] px-5 py-2.5 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272] disabled:opacity-60"
                  >
                    {payBusy === p.id ? "Opening payment…" : p.paid_until ? `Renew for 12 months · ${feeText}` : `Pay ${feeText} and go live for 12 months`}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => remove(p)} className="rounded-full border border-red-300 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60" data-testid="clinic-remove">
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        {st.eligible && !form && (
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => { setMsg(null); setForm(newForm()); }}
            data-testid="clinic-add"
            className={BTN}
          >
            {places.length === 0 ? "Add my clinic" : canAdd ? `Add another clinic (${feeText} a year)` : `You have ${max} clinics listed (the maximum)`}
          </button>
        )}

        {form && (
          <form onSubmit={save} className={`${CARD} space-y-4`} data-testid="clinic-form">
            <h2 className="text-lg font-extrabold text-ink-900">{form.id ? "Edit your clinic" : "Add your clinic"}</h2>
            <div>
              <label className={labelCls} htmlFor="cname">Clinic name</label>
              <input id="cname" required value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} data-testid="clinic-name" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="carea">Area</label>
                <select id="carea" required value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={inputCls} data-testid="clinic-area">
                  <option value="">Choose the area…</option>
                  {KARACHI_AREAS.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                  <option value="Other area of Karachi">Other area of Karachi</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="cphone">Clinic phone shown to families (optional)</label>
                <input id="cphone" value={form.phone} maxLength={30} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} data-testid="clinic-phone" />
                <p className="mt-1 text-xs text-ink-500">Your personal number on your Family Medic account is never shown.</p>
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="caddr">Address (optional)</label>
              <input id="caddr" value={form.address} maxLength={240} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="cnotes">Note for families (optional)</label>
              <input id="cnotes" value={form.notes} maxLength={400} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Ground floor, parking available" className={inputCls} />
            </div>
            <div>
              <span className={labelCls}>Pin of your clinic</span>
              <p className="mb-2 text-xs text-ink-500">This is what makes Directions take families to your door. Tap GPS while you are at the clinic, or paste a Google Maps link (the short Share link works).</p>
              <LocationPicker value={form.pin} onPick={(pin) => setForm({ ...form, pin })} ids={{ gps: "clinic-gps", paste: "clinic-paste", ok: "clinic-pin-ok" }} gpsLabel="I am at the clinic: use my GPS" />
            </div>
            <div>
              <span className={labelCls}>Opening hours</span>
              <HoursEditor value={form.hours} onChange={(hours) => setForm({ ...form, hours })} idPrefix="clinic-hours" />
            </div>
            {!form.id && !freeAvailable && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="clinic-fee-note">
                Your free clinic is already used, so this clinic is added first and goes live for 12 months once you pay {feeText}.
              </p>
            )}
            {!form.id && (
              <label className="flex items-start gap-2 text-sm text-ink-800">
                <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1 h-4 w-4 accent-teal-700" data-testid="clinic-consent" />
                <span>I confirm this is my clinic and I agree to it being listed on the Family Medic Locator.</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={BTN} data-testid="clinic-save">
                {busy ? "Saving…" : form.id ? "Save changes" : "Add my clinic"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-full border border-[#cfe0da] px-5 py-2.5 text-sm font-bold text-ink-700 hover:bg-[#f3f9f7]">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </DoctorShell>
  );
}
