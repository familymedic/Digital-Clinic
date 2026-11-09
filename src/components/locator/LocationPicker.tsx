"use client";

import { useState } from "react";
import { inPilot, resolveMapsInput } from "@/lib/locator";

// One shared way to set a place's pin (Locator). Three ways in, all optional:
//   1. "Use my GPS": the phone's own location, best when standing at the place;
//   2. paste any Google Maps link, including the short "Share" links (our server opens those);
//   3. paste plain coordinates such as "24.8138, 67.0300".
// The parent keeps the pin; this only reports it through onPick. Nothing is sent anywhere
// except the pasted link to our own server (short links only).

const inputCls =
  "w-full rounded-2xl border border-[#cfe0da] bg-white px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-600";

export interface PickedPin {
  lat: number;
  lng: number;
}

export default function LocationPicker({
  value,
  onPick,
  ids,
  placeholder = "https://maps.app.goo.gl/… or 24.8138, 67.0300",
  gpsLabel = "I am at the place: use my GPS",
}: {
  value: PickedPin | null;
  onPick: (p: PickedPin) => void;
  ids?: { gps?: string; paste?: string; ok?: string };
  placeholder?: string;
  gpsLabel?: string;
}) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"gps" | "link" | null>(null);

  function accept(c: PickedPin, how: string) {
    if (!inPilot(c.lat, c.lng)) {
      setMsg({ ok: false, text: "That location is outside Karachi. The pilot is Karachi only for now." });
      return;
    }
    onPick({ lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) });
    setMsg({ ok: true, text: how });
  }

  function useGps() {
    setMsg(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMsg({ ok: false, text: "This browser cannot share a location. Paste a Google Maps link below instead." });
      return;
    }
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        const acc = Math.round(pos.coords.accuracy || 0);
        accept(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          acc > 100
            ? `Pin saved, but your GPS is rough here (about ${acc} m). Step outside or near a window and tap again for a closer pin.`
            : acc
              ? `Pin saved from your GPS (accurate to about ${acc} m).`
              : "Pin saved from your GPS."
        );
      },
      () => {
        setBusy(null);
        setMsg({ ok: false, text: "We could not get the location. Allow location access for this site, or paste a Google Maps link below." });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function onPaste(v: string) {
    setPaste(v);
    const t = v.trim();
    if (!t) {
      setMsg(null);
      return;
    }
    setBusy("link");
    const c = await resolveMapsInput(t);
    setBusy(null);
    if (!c) {
      setMsg({
        ok: false,
        text: /^https?:\/\//i.test(t)
          ? "We could not read a location from that link. In Google Maps, open the place, tap Share, and paste the link here. Or press and hold the spot on the map and paste the two numbers that appear."
          : "We could not read that. Paste a Google Maps link, or two numbers like 24.8138, 67.0300.",
      });
      return;
    }
    accept(c, "Pin read from your link.");
  }

  return (
    <div>
      <button
        type="button"
        onClick={useGps}
        disabled={busy === "gps"}
        data-testid={ids?.gps}
        className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60"
      >
        {busy === "gps" ? "Finding the location…" : gpsLabel}
      </button>
      <label className="mt-4 block text-sm font-bold text-ink-900">…or paste a Google Maps link or coordinates</label>
      <input
        value={paste}
        onChange={(e) => void onPaste(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} mt-1.5`}
        data-testid={ids?.paste}
        inputMode="url"
      />
      {busy === "link" && <p className="mt-2 text-sm text-ink-500">Reading the link…</p>}
      {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? "text-teal-800" : "text-amber-800"}`}>{msg.text}</p>}
      {value && (
        <p className="mt-3 rounded-2xl bg-teal-50 p-3 text-sm text-teal-900" data-testid={ids?.ok}>
          Pin set ({value.lat.toFixed(5)}, {value.lng.toFixed(5)}).{" "}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${value.lat},${value.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold underline"
          >
            Check it on Google Maps
          </a>
        </p>
      )}
    </div>
  );
}
