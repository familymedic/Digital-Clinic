"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import {
  CATEGORY_LABEL,
  KARACHI_AREAS,
  KINDS,
  coordsFromMapsLink,
  inPilot,
  type LocatorCategory,
} from "@/lib/locator";

// Suggest a place (Locator, migration 0095). Used by volunteers standing at a place, by
// owners and by doctors. Nothing appears publicly until an admin approves it. The location
// comes from the phone's GPS (stand at the place) or from coordinates pasted from Google Maps.

const inputCls =
  "w-full rounded-2xl border border-[#cfe0da] bg-white px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-600";
const labelCls = "mb-1.5 block text-sm font-bold text-ink-900";

const ERRORS: Record<string, string> = {
  missing_fields: "Please fill in the name and the area.",
  need_location: "Please add the location of the place (use the button, or paste coordinates from Google Maps).",
  outside_pilot: "That location is outside Karachi. The pilot is Karachi only for now.",
  consent_required: "Please tick the box to confirm the owner or manager agrees to be listed.",
  need_contact: "Please add your name and a mobile number so we can confirm the details with you.",
  slow_down: "Too many submissions from this connection. Please wait a little and try again.",
  queue_full: "We have a lot waiting to be reviewed right now. Please try again in a few days.",
};

export default function SuggestForm() {
  const t = useSearchParams().get("tab");
  const startCat: LocatorCategory = t === "doctor" ? "doctor" : "autism";
  const [category, setCategory] = useState<LocatorCategory>(startCat);
  const [kind, setKind] = useState(KINDS[startCat][0].value);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [paste, setPaste] = useState("");
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [byName, setByName] = useState("");
  const [byPhone, setByPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  function changeCategory(c: LocatorCategory) {
    setCategory(c);
    setKind(KINDS[c][0].value);
  }

  function useHere() {
    setLocMsg(null);
    if (!navigator.geolocation) {
      setLocMsg("This browser cannot share a location. Paste coordinates from Google Maps instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!inPilot(lat, lng)) {
          setCoords(null);
          setLocMsg("That location is outside Karachi. The pilot is Karachi only for now.");
          return;
        }
        setCoords({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
        setLocMsg(null);
      },
      () => {
        setLocating(false);
        setLocMsg("We could not get the location. Allow location for this site, or paste coordinates from Google Maps.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function applyPaste(v: string) {
    setPaste(v);
    const c = coordsFromMapsLink(v);
    if (!c) {
      if (v.trim()) setLocMsg("We could not read coordinates from that. Paste a long Google Maps link or numbers like 24.8138, 67.0300.");
      return;
    }
    if (!inPilot(c.lat, c.lng)) {
      setCoords(null);
      setLocMsg("Those coordinates are outside Karachi. The pilot is Karachi only for now.");
      return;
    }
    setCoords({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
    setLocMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!coords) {
      setMsg(ERRORS.need_location);
      setState("error");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/locator/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, kind, name, area, address, phone, notes,
          lat: coords.lat, lng: coords.lng, byName, byPhone, consent, website,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        setState("done");
        return;
      }
      setMsg(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again.");
      setState("error");
    } catch {
      setMsg("Something went wrong. Please check your connection and try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div>
        <PageHeader title="Thank you" subtitle="Your suggestion is with our team." />
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <div className="rounded-3xl border border-[#d7e7e2] bg-white p-6 text-sm text-ink-700">
            <p className="font-bold text-ink-900">We have received it.</p>
            <p className="mt-2">
              A volunteer or our team will confirm the details with you before the place appears on the locator. This
              usually takes a few days.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/locator" className="rounded-full bg-teal-700 px-5 py-2.5 font-extrabold text-white hover:bg-teal-800">
                Back to the locator
              </Link>
              <button
                onClick={() => {
                  setState("idle");
                  setName("");
                  setAddress("");
                  setPhone("");
                  setNotes("");
                  setCoords(null);
                  setPaste("");
                  setConsent(false);
                }}
                className="rounded-full border border-teal-700 px-5 py-2.5 font-extrabold text-teal-800 hover:bg-teal-50"
              >
                Add another place
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Suggest a place"
        subtitle="Free. Suggest a place that welcomes autistic families, or a doctor or clinic you know. We confirm every place before it appears."
      />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href="/locator" className="text-sm font-medium text-teal-700 underline underline-offset-2">
          ← Back to the locator
        </Link>

        <p className="mt-4 rounded-2xl bg-[#fff6e8] p-4 text-sm text-ink-700">
          Do you <strong>own or run</strong> a clinic, pharmacy, lab or therapy / rehab centre? Please use{" "}
          <Link href="/locator/list" className="font-extrabold text-teal-800 underline underline-offset-2">
            List your workplace
          </Link>{" "}
          instead: it gets you a verified listing and a page that shows how many people found you.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-5 rounded-3xl border border-[#d7e7e2] bg-white p-5 sm:p-7">
          <div>
            <span className={labelCls}>Which list?</span>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#e6f1ed] p-1">
              {(["autism", "doctor"] as LocatorCategory[]).map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => changeCategory(c)}
                  aria-pressed={category === c}
                  className={`rounded-xl px-3 py-2.5 text-sm font-extrabold ${
                    category === c ? "bg-teal-700 text-white" : "text-ink-700"
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelCls}>Type of place</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
                {KINDS[category].map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Name of the place</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Area</span>
              <input
                required
                list="karachi-areas"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                maxLength={80}
                placeholder="e.g. Gulshan-e-Iqbal"
                className={inputCls}
              />
              <datalist id="karachi-areas">
                {KARACHI_AREAS.map((a) => (
                  <option key={a.name} value={a.name} />
                ))}
              </datalist>
            </label>
            <label>
              <span className={labelCls}>Phone of the place (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={labelCls}>Address (optional)</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={240} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>
              {category === "autism" ? "How do they help? (optional)" : "Timings or details (optional)"}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={400}
              rows={3}
              placeholder={
                category === "autism"
                  ? "e.g. Quiet hours Tue to Thu 11am to 1pm, staff oriented, patient with waiting"
                  : "e.g. Evening OPD 5 to 9pm"
              }
              className={inputCls}
            />
          </label>

          {/* Location */}
          <div className="rounded-2xl bg-[#f3f9f7] p-4">
            <span className={labelCls}>Location of the place</span>
            <p className="text-xs text-ink-500">
              Standing at the place? Tap the button. Otherwise paste a long Google Maps link, or the numbers you get
              when you tap and hold the spot on the map.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={useHere}
                disabled={locating}
                className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {locating ? "Getting location…" : "I am at this place now"}
              </button>
              {coords && (
                <span className="text-sm font-bold text-teal-800">
                  ✓ Location added ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
                </span>
              )}
            </div>
            <input
              value={paste}
              onChange={(e) => applyPaste(e.target.value)}
              placeholder="Or paste a Google Maps link / coordinates"
              className={`${inputCls} mt-3`}
            />
            {locMsg && <p className="mt-2 text-sm text-amber-800">{locMsg}</p>}
          </div>

          {/* Who is submitting */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelCls}>Your name</span>
              <input required value={byName} onChange={(e) => setByName(e.target.value)} maxLength={80} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Your mobile number</span>
              <input
                required
                value={byPhone}
                onChange={(e) => setByPhone(e.target.value)}
                maxLength={30}
                inputMode="tel"
                className={inputCls}
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-ink-500">Your name and number are private. Only our team can see them.</p>

          <label className="flex items-start gap-3 text-sm text-ink-700">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>
              The owner or manager of this place knows about this and agrees to be listed on the Family Medic Locator.
            </span>
          </label>

          {/* honeypot */}
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            aria-hidden="true"
            name="website"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />

          {state === "error" && msg && <p className="text-sm font-semibold text-red-700">{msg}</p>}
          <button
            type="submit"
            disabled={state === "sending" || !consent}
            className="w-full rounded-full bg-teal-700 px-6 py-3.5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60 sm:w-auto"
          >
            {state === "sending" ? "Sending…" : "Send for review"}
          </button>
        </form>
      </div>
    </div>
  );
}
