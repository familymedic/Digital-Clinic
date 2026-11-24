"use client";

import AreaOptions from "@/components/locator/AreaOptions";
import InstallAppBanner from "@/components/InstallAppBanner";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  AUTISM_DISCLAIMER,
  CATEGORY_LABEL,
  DOCTOR_DISCLAIMER,
  VACCINATION_DISCLAIMER,
  VACCINATION_FEE_NOTE,
  VACCINATION_PRIVATE_NOTE,
  hoursSummary,
  shareText,
  ALL_AREAS,
  SERVICE_AREA_TEXT,
  AUTO_WIDEN_MIN,
  KINDS,
  RADII,
  TILES,
  directionsHref,
  hoursLines,
  hoursStatus,
  cityFor,
  inPilot,
  kindLabel,
  telHref,
  trustLabel,
  type LocatorCategory,
  type LocatorResult,
  type Origin,
} from "@/lib/locator";

// Family Medic Locator (migrations 0095 to 0099). Category tiles, a category screen for
// Autism-Aware Places, and results with a numbered pin map and a "best match" card. When a search
// finds too little close by, the page widens the distance by itself (3 > 5 > 10 > 20 > 30 km) and
// says so; the family can also pick a wider distance.
//
// Privacy: the visitor's coordinates live only in this component's memory and in the one
// search call. They are never saved, never put in a link, never sent to a map service.
// Usage is counted anonymously (event + tab, no location) through /api/locator/event.
// The map position of each result is rounded to about 100 m by the database; the exact pin
// only leaves the server inside the counted Directions link.

type Extra = { ids?: string[]; area?: string; placeId?: string };

function track(event: string, category?: LocatorCategory, extra?: Extra) {
  try {
    fetch("/api/locator/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, category: category ?? "none", ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // counting must never break the page
  }
}

type Phase = "idle" | "locating" | "searching" | "done" | "error";
type Screen = "home" | "category" | "results";
type Counts = { doctor: number; pharmacy: number; therapy: number; autism: number; vaccination: number; vaccination_private: number };

const KIND_ICON: Record<string, string> = {
  barber: "M4 20L16 8M13 5l6 6M8 8l12 12",
  salon: "M3 7h18v13H3zM8 7V4h8v3M3 13h18",
  restaurant: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M12 3v18M17 3c-2 2-2 8 0 9v9",
  cafe: "M5 9h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM17 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3",
  market: "M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0",
  mall: "M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0",
  park: "M12 21v-7M12 14c-4 0-6-3-6-6 3 0 6 1 6 6zM12 12c0-4 2-7 6-7 0 4-2 7-6 7z",
  school: "M3 9l9-5 9 5-9 5zM7 11.5V16c0 1.5 2.5 3 5 3s5-1.5 5-3v-4.5",
  other: "M5 12h.01M12 12h.01M19 12h.01",
};

export default function LocatorApp() {
  // /locator?tab=autism|therapy|pharmacy|doctor opens that category directly. (This component sits
  // inside a Suspense boundary on the page, so the page's own text stays static for search engines.)
  const tabParam = useSearchParams().get("tab");
  const startTab: LocatorCategory | null =
    tabParam === "autism" || tabParam === "therapy" || tabParam === "doctor" || tabParam === "pharmacy" || tabParam === "vaccination" ? tabParam : null;
  const [screen, setScreen] = useState<Screen>(startTab ? (startTab === "autism" ? "category" : "results") : "home");
  const [tab, setTab] = useState<LocatorCategory>(startTab ?? "doctor");
  const [radius, setRadius] = useState<number>(3);
  const [kind, setKind] = useState<string>("");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<LocatorResult[]>([]);
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({});
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [outside, setOutside] = useState(false);
  const [live, setLive] = useState(true);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [widenedFrom, setWidenedFrom] = useState<number | null>(null);
  const [fallback, setFallback] = useState<LocatorResult | null>(null);
  const [justOpened, setJustOpened] = useState<Record<string, boolean>>({});
  const manualRadius = useRef<number | null>(null);
  const reqId = useRef(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  // How many places are listed + whether the admin has the locator switched on.
  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let cancelled = false;
    (async () => {
      const { data } = await db.rpc("locator_counts");
      if (cancelled || !data || typeof data !== "object") return;
      const d = data as { live?: boolean; doctor?: number; pharmacy?: number; therapy?: number; autism?: number; vaccination?: number; vaccination_private?: number };
      setLive(d.live !== false);
      setCounts({ doctor: Number(d.doctor ?? 0), pharmacy: Number(d.pharmacy ?? 0), therapy: Number(d.therapy ?? 0), autism: Number(d.autism ?? 0), vaccination: Number(d.vaccination ?? 0), vaccination_private: Number(d.vaccination_private ?? 0) });
    })();
    // Which cities are still "just opened" (migration 0099). Older databases simply return nothing.
    (async () => {
      const { data } = await db.rpc("locator_regions_public");
      if (cancelled || !Array.isArray(data)) return;
      const m: Record<string, boolean> = {};
      for (const x of data as { city?: string; just_opened?: boolean }[]) if (x.city && x.just_opened) m[x.city] = true;
      setJustOpened(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const originLabel = (o: Origin) => (o.kind === "area" ? o.area : "My location");

  const runSearch = useCallback(async (o: Origin, cat: LocatorCategory, r: number, k: string, auto = true) => {
    if (!supabase) {
      setPhase("error");
      return;
    }
    const id = ++reqId.current;
    setPhase("searching");
    setActive(null);
    setFallback(null);
    track("search", cat);
    const db = supabase;
    const fetchAt = async (km: number) => {
      const { data, error } = await db.rpc("locator_search", {
        p_lat: o.lat,
        p_lng: o.lng,
        p_radius_km: km,
        p_category: cat,
        p_kind: k || null,
      });
      if (error) return null;
      return ((data ?? []) as LocatorResult[]).map((x) => ({
        ...x,
        distance_km: Number(x.distance_km),
        map_lat: x.map_lat === null ? null : Number(x.map_lat),
        map_lng: x.map_lng === null ? null : Number(x.map_lng),
      }));
    };
    let cur = r;
    let rows = await fetchAt(cur);
    if (id !== reqId.current) return; // a newer search replaced this one
    if (rows === null) {
      setPhase("error");
      return;
    }
    // Too little close by: widen by itself, one step at a time, and say so.
    let widened = false;
    while (auto && rows.length < AUTO_WIDEN_MIN) {
      const nextR = RADII.find((x) => x > cur);
      if (!nextR) break;
      cur = nextR;
      widened = true;
      const more = await fetchAt(cur);
      if (id !== reqId.current) return;
      if (more === null) break;
      rows = more;
    }
    setRadius(cur);
    setWidenedFrom(widened ? r : null);
    if (widened) track("widen", cat);
    setResults(rows);
    if (!k) {
      const c: Record<string, number> = {};
      for (const x of rows) c[x.kind] = (c[x.kind] ?? 0) + 1;
      setKindCounts(c);
    }
    // Still nothing at the widest distance: point to the nearest hospital instead of a dead end.
    if (rows.length === 0 && cat !== "autism" && cat !== "vaccination" && k !== "hospital") {
      const { data } = await db.rpc("locator_search", {
        p_lat: o.lat, p_lng: o.lng, p_radius_km: RADII[RADII.length - 1], p_category: "doctor", p_kind: "hospital",
      });
      if (id !== reqId.current) return;
      const h = Array.isArray(data) && data.length ? (data[0] as LocatorResult) : null;
      setFallback(h ? { ...h, distance_km: Number(h.distance_km), map_lat: null, map_lng: null } : null);
    }
    setPhase("done");
    setActive(rows.length ? rows[0].id : null);
    const area = o.kind === "area" ? o.area : "My location";
    if (rows.length) track("results", cat, { ids: rows.map((x) => x.id), area });
    else track("empty", cat, { area });
  }, []);

  // The distance a fresh search starts from: what the family picked, or the first step.
  const baseRadius = () => manualRadius.current ?? RADII[0];

  function setOriginAndSearch(o: Origin) {
    setOutside(false);
    setOrigin(o);
    if (screen !== "home") runSearch(o, tab, baseRadius(), kind);
  }

  function useMyLocation() {
    setGpsMessage(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsMessage("This browser cannot share a location. Please pick your area instead.");
      track("gps_denied", tab);
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!inPilot(lat, lng)) {
          setOutside(true);
          setOrigin(null);
          setResults([]);
          setPhase("idle");
          track("coming_soon", tab);
          return;
        }
        setOutside(false);
        const o: Origin = { kind: "gps", lat, lng };
        setOrigin(o);
        if (screen !== "home") runSearch(o, tab, baseRadius(), kind);
        else setPhase("idle");
      },
      () => {
        setPhase("idle");
        setGpsMessage("We could not get your location (it may be switched off or blocked). No problem: pick your area instead.");
        track("gps_denied", tab);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  }

  function pickArea(name: string) {
    const a = ALL_AREAS.find((x) => x.name === name);
    if (!a) return;
    setGpsMessage(null);
    setOriginAndSearch({ kind: "area", lat: a.lat, lng: a.lng, area: a.name });
  }

  function openTile(cat: LocatorCategory) {
    setTab(cat);
    setKind("");
    setKindCounts({});
    setResults([]);
    setOpenOnly(false);
    setPhase("idle");
    setScreen(cat === "autism" ? "category" : "results");
    if (origin && !outside) runSearch(origin, cat, baseRadius(), "");
  }

  function openKind(k: string) {
    setKind(k);
    setScreen("results");
    if (origin && !outside) runSearch(origin, tab, baseRadius(), k);
  }

  // A distance the family picked: honoured exactly (no automatic widening).
  function changeRadius(r: number) {
    manualRadius.current = r;
    setRadius(r);
    setWidenedFrom(null);
    if (origin && !outside) runSearch(origin, tab, r, kind, false);
  }

  function changeKind(k: string) {
    setKind(k);
    if (origin && !outside) runSearch(origin, tab, baseRadius(), k);
  }

  function back() {
    if (screen === "results" && tab === "autism" && kind) {
      setKind("");
      setScreen("category");
      if (origin && !outside) runSearch(origin, tab, baseRadius(), "");
      return;
    }
    setScreen("home");
    setPhase("idle");
    setResults([]);
    setKind("");
  }

  function pickPin(id: string) {
    setActive(id);
    const el = listRef.current?.querySelector(`[data-place="${id}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (!live) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        The locator is taking a short break. Please check back soon.
      </div>
    );
  }

  const where = origin ? originLabel(origin) : null;
  const originCity = origin ? cityFor(origin.lat, origin.lng) : null;

  /* ---------------------------------------------------------------- HOME */
  if (screen === "home") {
    return (
      <div data-testid="locator-home">
        <div className="rounded-3xl bg-white p-4 sm:p-5">
          <p className="text-xs font-extrabold tracking-[0.16em] text-teal-700">WHERE ARE YOU?</p>
          <LocationPicker
            origin={origin}
            phase={phase}
            gpsMessage={gpsMessage}
            onGps={useMyLocation}
            onArea={pickArea}
          />
        </div>

        {outside && <ComingSoon tab={tab} onPickKarachi={() => setOutside(false)} />}

        <JustOpenedTag city={originCity} justOpened={justOpened} />

        <p className="mt-5 text-xs font-extrabold tracking-[0.16em] text-teal-700">WHAT ARE YOU LOOKING FOR?</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {TILES.map((t) => (
            <button
              key={t.category}
              onClick={() => openTile(t.category)}
              data-testid={`locator-tile-${t.category}`}
              className={`group relative flex overflow-hidden rounded-[26px] p-4 text-left shadow-[0_18px_34px_-26px_rgba(7,41,39,0.6)] transition hover:-translate-y-0.5 sm:p-5 ${
                t.category === "vaccination" ? "col-span-2 min-h-[104px] flex-row items-center gap-4" : "min-h-[148px] flex-col items-start sm:min-h-[168px]"
              }`}
              style={{
                background:
                  t.category === "doctor"
                    ? "linear-gradient(145deg,#e3f4f0,#c5ebe3)"
                    : t.category === "pharmacy"
                      ? "linear-gradient(145deg,#fff1d6,#ffe0a8)"
                      : t.category === "therapy"
                        ? "linear-gradient(145deg,#e8eefc,#d2defa)"
                        : t.category === "vaccination"
                          ? "linear-gradient(145deg,#e4f6dc,#c9eebb)"
                          : "linear-gradient(145deg,#ffe9e2,#ffd4c8)",
              }}
            >
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-white/90 shadow-sm">
                <TileIcon category={t.category} />
              </span>
              <span className={t.category === "vaccination" ? "block min-w-0 flex-1" : "contents"}>
                <span className={`block text-[17px] font-extrabold leading-tight text-ink-900 ${t.category === "vaccination" ? "" : "mt-3"}`}>{t.title}</span>
                <span className="mt-1 block text-[12.5px] leading-snug text-ink-700">{t.blurb}</span>
                {counts && counts[t.category] > 0 && (
                  <span className={`block text-xs font-extrabold text-teal-800 ${t.category === "vaccination" ? "mt-1" : "mt-auto pt-2"}`}>
                    {counts[t.category]} {counts[t.category] === 1 ? (t.category === "vaccination" ? "centre" : "place") : t.category === "vaccination" ? "centres" : "places"} listed
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-[20px] border border-[#ffd2cb] bg-[#fff4f2] p-3.5 text-[13px] text-[#7a2a1f]">
          <span aria-hidden="true" className="text-lg leading-none">🚨</span>
          <p>
            <strong className="text-[#e0523f]">Emergency?</strong> Do not search. Call 1122 or go to the nearest hospital.
          </p>
        </div>

        <InstallAppBanner variant="locator" />
        <ListYourWorkplace />
        <Footer tab="autism" />
      </div>
    );
  }

  /* ------------------------------------------- CATEGORY (autism-aware types) */
  if (screen === "category") {
    const total = Object.values(kindCounts).reduce((a, b) => a + b, 0);
    return (
      <div data-testid="locator-category">
        <ScreenBand
          title="Autism-Aware Places"
          subtitle={
            where
              ? `${where} · within ${radius} km`
              : "Teams oriented by volunteers of the Vulnerable Women and Children Organization. Pick a type."
          }
          onBack={back}
          radius={radius}
          onRadius={changeRadius}
          showRadius={Boolean(origin)}
        />
        {!origin && (
          <div className="mt-4 rounded-3xl bg-white p-4 sm:p-5">
            <p className="text-xs font-extrabold tracking-[0.16em] text-teal-700">WHERE ARE YOU?</p>
            <LocationPicker origin={origin} phase={phase} gpsMessage={gpsMessage} onGps={useMyLocation} onArea={pickArea} />
          </div>
        )}
        {outside && <ComingSoon tab={tab} onPickKarachi={() => setOutside(false)} />}

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {KINDS.autism.map((k) => {
            const n = kindCounts[k.value] ?? 0;
            return (
              <button
                key={k.value}
                onClick={() => openKind(k.value)}
                data-testid={`locator-kind-${k.value}`}
                className="flex min-h-[92px] flex-col gap-2 rounded-[22px] border border-[#d7e7e2] bg-white p-3.5 text-left transition hover:border-teal-600"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={KIND_ICON[k.value] ?? KIND_ICON.other} />
                </svg>
                <span className="text-[15px] font-extrabold text-ink-900">{k.label}</span>
                <span className="text-xs font-semibold text-ink-500">
                  {!origin ? "Tap to see" : phase === "searching" ? "…" : n > 0 ? `${n} nearby` : "None yet"}
                </span>
              </button>
            );
          })}
        </div>

        {origin && phase === "done" && total > 0 && (
          <div className="mt-4 rounded-3xl border border-[#d7e7e2] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-ink-900">Nearest to you</p>
              <button
                onClick={() => {
                  setKind("");
                  setScreen("results");
                }}
                className="inline-flex items-center gap-1 text-xs font-extrabold text-teal-700"
              >
                Show {Math.min(total, 15)} on map
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-ink-900">{results[0].name}</p>
                <span className="mt-1 inline-flex rounded-full bg-[#fff6e8] px-2.5 py-1 text-[11px] font-extrabold text-[#7a4a00]">
                  Autism-Aware Place
                </span>
              </div>
              <span className="flex-none rounded-full bg-teal-50 px-2.5 py-1.5 text-[13px] font-extrabold text-teal-800">
                {results[0].distance_km < 0.1 ? "<0.1" : results[0].distance_km.toFixed(1)} km
              </span>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 rounded-[20px] border-[1.5px] border-dashed border-[#9fcfc4] bg-white p-4">
          <p className="text-[13px] font-bold leading-snug text-ink-900">Know a place that is kind to autistic families?</p>
          <Link
            href="/locator/suggest?tab=autism"
            className="inline-flex min-h-11 flex-none items-center rounded-full bg-teal-700 px-4 text-[13px] font-extrabold text-white hover:bg-teal-800"
          >
            Suggest it
          </Link>
        </div>
        <Footer tab="autism" />
      </div>
    );
  }

  /* ------------------------------------------------------------- RESULTS */
  const kinds = KINDS[tab];
  const privateView = tab === "vaccination" && kind === "private";
  const title = privateView ? "Private vaccines" : kind ? (kinds.find((k) => k.value === kind)?.label ?? CATEGORY_LABEL[tab]) : CATEGORY_LABEL[tab];
  const anyHours = results.some((r) => r.hours);
  const filtered = openOnly ? results.filter((r) => hoursStatus(r.hours)?.open) : results;
  // Featured first, then open now, then places without hours, then closed; nearest first inside each group.
  const rank = (r: LocatorResult) => {
    if (r.featured) return 0;
    const st = hoursStatus(r.hours);
    return st ? (st.open ? 1 : 3) : 2;
  };
  const shown = [...filtered].sort((x, y) => rank(x) - rank(y) || x.distance_km - y.distance_km);
  const openCount = shown.filter((r) => hoursStatus(r.hours)?.open).length;
  const activePlace = shown.find((r) => r.id === active) ?? null;
  const hasMap = Boolean(origin && !outside && phase === "done" && shown.length > 0);
  const vaccPrivateChip = tab === "vaccination" && (counts?.vaccination_private ?? 0) > 0;
  const typeChips =
    origin && !outside && (kinds.length > 1 || anyHours || vaccPrivateChip) ? (
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Type of place">
        {kinds.length > 1 && (
          <>
            <Chip active={kind === ""} onClick={() => changeKind("")}>
              All
            </Chip>
            {kinds.map((k) => (
              <Chip key={k.value} active={kind === k.value} onClick={() => changeKind(k.value)}>
                {k.label}
              </Chip>
            ))}
          </>
        )}
        {vaccPrivateChip && (
          <Chip active={privateView} onClick={() => changeKind(privateView ? "" : "private")}>
            Private vaccines
          </Chip>
        )}
        {anyHours && (
          <Chip active={openOnly} onClick={() => setOpenOnly((v) => !v)}>
            Open now
          </Chip>
        )}
      </div>
    ) : null;
  return (
    <div data-testid="locator-results-screen">
      <ScreenBand
        title={title}
        subtitle={
          phase === "done" && origin
            ? `${shown.length === 0 ? "Nothing listed yet" : `${shown.length} ${shown.length === 1 ? "place" : "places"}`} within ${radius} km of ${origin.kind === "area" ? origin.area : "you"}${shown.length > 0 && openCount > 0 ? ` · ${openCount} open now` : ""}`
            : phase === "searching" || phase === "locating"
              ? "Looking nearby…"
              : "Tell us where you are to see what is close."
        }
        onBack={back}
        radius={radius}
        onRadius={changeRadius}
        showRadius
        overlap={hasMap}
      />

      {!origin && (
        <div className="mt-4 rounded-3xl bg-white p-4 sm:p-5">
          <p className="text-xs font-extrabold tracking-[0.16em] text-teal-700">WHERE ARE YOU?</p>
          <LocationPicker origin={origin} phase={phase} gpsMessage={gpsMessage} onGps={useMyLocation} onArea={pickArea} />
          {counts && counts[tab] > 0 && (
            <p className="mt-3 text-xs font-semibold text-ink-500">
              {counts[tab]} {counts[tab] === 1 ? "place is" : "places are"} listed so far in {SERVICE_AREA_TEXT}.
            </p>
          )}
        </div>
      )}
      {outside && <ComingSoon tab={tab} onPickKarachi={() => setOutside(false)} />}

      {hasMap && origin && <PinMap origin={origin} results={shown} radius={radius} active={active} onPick={pickPin} selected={activePlace} tab={tab} />}
      {origin && !outside && <JustOpenedTag city={originCity} justOpened={justOpened} />}
      {typeChips}
      {tab === "vaccination" && origin && !outside && phase === "done" && shown.length > 0 && (
        <p className="mt-3 text-[13px] font-semibold text-ink-700" data-testid="locator-vacc-scope">
          {privateView ? "Showing centres that offer private vaccines." : "Showing centres that give government vaccines."}
        </p>
      )}

      {origin && !outside && (
        <div className="mt-4" aria-live="polite">
          {(phase === "searching" || phase === "locating") && <p className="text-sm text-ink-500">Looking nearby…</p>}
          {phase === "error" && (
            <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">
              Something went wrong while searching. Please try again in a moment.
            </p>
          )}
          {phase === "done" && widenedFrom !== null && shown.length > 0 && (
            <div className="mb-3 rounded-2xl border border-[#b9e3dd] bg-[#e2f4f1] p-3.5 text-sm text-teal-950" data-testid="locator-widened">
              <p className="font-extrabold">
                Nothing within {widenedFrom} km, so we widened to {radius} km.
              </p>
              <p className="mt-0.5 text-[13px]">These places are a little further away.</p>
            </div>
          )}
          {phase === "done" && shown.length > 0 && (
            <ul ref={listRef} className="space-y-3">
              {shown.map((r, i) => (
                <ResultCard key={r.id} r={r} n={i + 1} tab={tab} active={active === r.id} onSelect={() => setActive(r.id)} />
              ))}
            </ul>
          )}
          {phase === "done" && shown.length > 0 && RADII.find((x) => x > radius) && (
            <button
              onClick={() => changeRadius(RADII.find((x) => x > radius) as number)}
              data-testid="locator-search-wider"
              className="mt-3 w-full rounded-2xl border-2 border-dashed border-teal-700 bg-white py-3 text-sm font-extrabold text-teal-800 hover:bg-teal-50"
            >
              Search wider: {RADII.find((x) => x > radius)} km
            </button>
          )}
          {phase === "done" && shown.length === 0 && openOnly && results.length > 0 && (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink-700" data-testid="locator-none-open">
              Nothing with opening hours is open right now within {radius} km. Switch off &ldquo;Open now&rdquo; to see everything.
            </p>
          )}
          {phase === "done" && shown.length === 0 && !(openOnly && results.length > 0) && (
            <div data-testid="locator-empty">
              <div className="rounded-2xl border border-[#f3d9a0] bg-[#fff7e6] p-4 text-sm text-[#5a3d00]">
                <p className="font-extrabold">
                  {RADII[RADII.length - 1] === radius ? `Nothing listed within ${radius} km yet.` : "We have not listed anything here yet."}
                </p>
                <p className="mt-1">
                  {tab === "vaccination"
                    ? privateView
                      ? "No centres with private vaccines are listed near you yet."
                      : "We are adding vaccination centres district by district. Until then, please ask at your nearest government health centre or your Lady Health Worker."
                    : "We add places every week. "}
                  {tab === "vaccination" ? "" : tab === "autism"
                    ? "If you know a barber shop, restaurant, shop or school that is kind to autistic families, tell us and we will invite them."
                    : "If you run a clinic, pharmacy or therapy centre, you can list it in two short steps."}
                </p>
              </div>
              {fallback && (
                <div className="mt-3 rounded-2xl border border-[#d7e7e2] bg-white p-4" data-testid="locator-fallback">
                  <p className="text-xs font-extrabold tracking-[0.14em] text-teal-700">NEAREST HOSPITAL</p>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-extrabold text-ink-900">{fallback.name}</p>
                      <p className="text-xs text-ink-500">{fallback.area}</p>
                    </div>
                    <span className="flex-none rounded-full bg-teal-50 px-2.5 py-1.5 text-[13px] font-extrabold text-teal-800">
                      {fallback.distance_km.toFixed(1)} km
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <a href={directionsHref(fallback.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800">
                      Directions
                    </a>
                    {fallback.phone && (
                      <a href={telHref(fallback.phone)} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#d9f3ee] px-5 text-sm font-extrabold text-teal-900">
                        Call
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {vaccPrivateChip && !privateView && (
                  <button
                    onClick={() => changeKind("private")}
                    data-testid="locator-see-private"
                    className="inline-flex rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800"
                  >
                    See centres with private vaccines
                  </button>
                )}
                {RADII.find((x) => x > radius) && (
                  <button
                    onClick={() => changeRadius(RADII.find((x) => x > radius) as number)}
                    className="inline-flex rounded-full border border-teal-700 px-5 py-2.5 text-sm font-extrabold text-teal-800 hover:bg-teal-50"
                  >
                    Search wider: {RADII.find((x) => x > radius)} km
                  </button>
                )}
                {tab !== "vaccination" && (
                  <Link
                    href={tab === "autism" ? "/locator/suggest?tab=autism" : "/locator/list"}
                    className="inline-flex rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800"
                  >
                    {tab === "autism" ? "Suggest a place" : "List your workplace"}
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab !== "autism" && tab !== "vaccination" && <ListYourWorkplace />}
      <Footer tab={tab} privateView={privateView} />
    </div>
  );
}

/* ================================================================ pieces */

function TileIcon({ category }: { category: LocatorCategory }) {
  const common = { width: 30, height: 30, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (category === "doctor")
    return (
      <svg {...common} stroke="#0f766e" aria-hidden="true">
        <path d="M6 3v6a4 4 0 0 0 8 0V3" />
        <path d="M10 13v3a4 4 0 0 0 8 0v-1" />
        <circle cx="18" cy="12" r="2" />
      </svg>
    );
  if (category === "pharmacy")
    return (
      <svg {...common} stroke="#1f7a3a" aria-hidden="true">
        <rect x="3" y="9" width="18" height="11" rx="2" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
        <path d="M12 12.5v4M10 14.5h4" />
      </svg>
    );
  if (category === "therapy")
    return (
      <svg {...common} stroke="#2f4fb0" aria-hidden="true">
        <circle cx="12" cy="5" r="2.2" />
        <path d="M5 21l3-8 4-2 4 2 3 8" />
        <path d="M8 13l-3-3M16 13l3-3" />
      </svg>
    );
  if (category === "vaccination")
    return (
      <svg {...common} stroke="#2d7a1f" aria-hidden="true">
        <path d="M18 2l4 4M20 4l-2.5 2.5M16.5 7.5l-9 9M14 5l5 5-2 2-5-5zM7.5 16.5L4 20M10 14l-2 2M13 11l-2 2" />
      </svg>
    );
  return (
    <svg {...common} stroke="#a15c00" aria-hidden="true">
      <path d="M12 12c-2-3.5-6-3.5-6 0 0 3.5 4 3.5 6 0 2-3.5 6-3.5 6 0 0 3.5-4 3.5-6 0z" />
    </svg>
  );
}

function JustOpenedTag({ city, justOpened }: { city: string | null; justOpened: Record<string, boolean> }) {
  if (!city || !justOpened[city]) return null;
  return (
    <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#fff1d6] px-3.5 py-1.5 text-xs font-extrabold text-[#7a4a00]" data-testid="locator-just-opened">
      <span className="h-1.5 w-1.5 rounded-full bg-[#ffb020]" aria-hidden="true" />
      Just opened in {city} · new places are being added every week
    </p>
  );
}

function ScreenBand(props: {
  title: string;
  subtitle: string;
  onBack: () => void;
  radius: number;
  onRadius: (r: number) => void;
  showRadius: boolean;
  overlap?: boolean;
}) {
  return (
    <div
      className={`-mx-4 -mt-4 rounded-b-[30px] bg-[linear-gradient(180deg,#0a3733,#072927)] px-4 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 ${
        props.overlap ? "pb-[70px]" : "pb-6"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={props.onBack}
          aria-label="Back"
          data-testid="locator-back"
          className="grid h-11 w-11 place-items-center rounded-xl border border-white/30"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        {props.showRadius && (
          <div className="flex gap-1 rounded-full bg-white/10 p-1" role="group" aria-label="Distance">
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => props.onRadius(r)}
                aria-pressed={props.radius === r}
                data-testid={`locator-radius-${r}`}
                className={`whitespace-nowrap rounded-full px-2 py-1.5 text-[11px] font-extrabold sm:px-3 sm:text-xs ${
                  props.radius === r ? "bg-[#ffb454] text-[#3b2500]" : "text-white"
                }`}
              >
                {r} km
              </button>
            ))}
          </div>
        )}
      </div>
      <h2 className="mt-3.5 text-2xl font-extrabold leading-tight text-white">{props.title}</h2>
      <p className="mt-1 text-[13px] font-semibold text-[#c9ece5]" data-testid="locator-summary">
        {props.subtitle}
      </p>
    </div>
  );
}

function LocationPicker(props: {
  origin: Origin | null;
  phase: Phase;
  gpsMessage: string | null;
  onGps: () => void;
  onArea: (name: string) => void;
}) {
  return (
    <div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={props.onGps}
          disabled={props.phase === "locating"}
          data-testid="locator-use-location"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-teal-700 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-teal-800 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            <circle cx="12" cy="12" r="8" />
          </svg>
          {props.phase === "locating" ? "Finding you…" : props.origin?.kind === "gps" ? "Using your location" : "Use my location"}
        </button>
        <span className="text-xs font-bold text-ink-400">or</span>
        <label className="flex-1">
          <span className="sr-only">Pick your area</span>
          <select
            value={props.origin?.kind === "area" ? props.origin.area : ""}
            onChange={(e) => props.onArea(e.target.value)}
            data-testid="locator-area"
            className="min-h-11 w-full rounded-full border border-[#cfe0da] bg-white px-4 py-3 text-sm font-semibold text-ink-900 outline-none focus:border-teal-600"
          >
            <option value="">Pick your area…</option>
            <AreaOptions />
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-ink-500">Your location is used only for this search. We do not save it or share it.</p>
      {props.gpsMessage && <p className="mt-3 text-sm text-amber-800">{props.gpsMessage}</p>}
    </div>
  );
}

function ListYourWorkplace() {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-[20px] bg-[#fff6e8] p-4">
      <p className="text-[13px] font-extrabold leading-snug text-ink-900">
        Own a clinic, pharmacy
        <br />
        or therapy centre?
      </p>
      <Link
        href="/locator/list"
        data-testid="locator-list-cta"
        className="inline-flex min-h-11 flex-none items-center rounded-full bg-[#ffb454] px-4 text-[13px] font-extrabold text-[#3b2500] hover:bg-[#ffc272]"
      >
        List your workplace
      </Link>
    </div>
  );
}

function Footer({ tab, privateView = false }: { tab: LocatorCategory; privateView?: boolean }) {
  return (
    <div className="mt-5 space-y-2 text-xs leading-relaxed text-ink-500">
      {tab === "vaccination" && (
        <p data-testid="locator-vacc-note" className="font-semibold text-ink-700">
          {privateView ? VACCINATION_PRIVATE_NOTE : VACCINATION_FEE_NOTE}
        </p>
      )}
      <p>{tab === "autism" ? AUTISM_DISCLAIMER : tab === "vaccination" ? VACCINATION_DISCLAIMER : DOCTOR_DISCLAIMER}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm ${
        active ? "border-teal-700 bg-teal-50 text-teal-800" : "border-[#d7e7e2] bg-white text-ink-700 hover:border-teal-600"
      }`}
    >
      {children}
    </button>
  );
}

// An illustrative radar-style map: you are the blue dot in the middle, the dashed ring is the
// distance you picked, and each numbered pin sits at its true direction and distance (positions
// are rounded to ~100 m on the server). It is a drawing, not a street map; Directions opens
// the real thing in Google Maps.
function PinMap(props: {
  origin: Origin;
  results: LocatorResult[];
  radius: number;
  active: string | null;
  onPick: (id: string) => void;
  selected?: LocatorResult | null;
  tab?: LocatorCategory;
}) {
  const W = 354;
  const H = 230;
  const cx = 177;
  const cy = 118;
  const R = 98;
  const kmPerPx = props.radius / R;
  const cosLat = Math.cos((props.origin.lat * Math.PI) / 180);
  const pins = props.results.slice(0, 20).map((r, i) => {
    let dx = 0;
    let dy = 0;
    if (r.map_lat !== null && r.map_lng !== null) {
      dx = ((r.map_lng - props.origin.lng) * 111.32 * cosLat) / kmPerPx;
      dy = (-(r.map_lat - props.origin.lat) * 110.57) / kmPerPx;
    }
    const d = Math.hypot(dx, dy);
    const k = d > R - 6 ? (R - 6) / d : 1;
    return { r, n: i + 1, x: cx + dx * k, y: cy + dy * k };
  });
  // draw the active pin last so it is on top
  const ordered = [...pins].sort((a, b) => Number(a.r.id === props.active) - Number(b.r.id === props.active));
  return (
    <div
      className="relative -mt-[52px] h-[300px] overflow-hidden rounded-[26px] border border-[#d7e7e2] bg-[#e6f0ea] shadow-[0_20px_38px_-26px_rgba(7,41,39,0.65)]"
      data-testid="locator-map"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-x-0 top-0 h-[230px] w-full" role="img" aria-label="Illustrative map with numbered pins for each result" preserveAspectRatio="xMidYMid slice">
        <rect width={W} height={H} fill="#e6f0ea" />
        <path d="M0 200 C70 188 130 222 210 208 C280 196 330 222 354 212 L354 230 L0 230 Z" fill="#bfe0ec" />
        <path d="M20 40 C50 22 100 30 112 62 C120 92 70 104 38 94 C12 84 8 56 20 40 Z" fill="#cfe7d2" />
        <g stroke="#fff" strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M-10 120 C70 105 160 135 230 112 C290 94 330 100 364 90" />
          <path d="M118 -10 C126 50 108 110 132 170 C140 195 138 215 140 240" />
          <path d="M262 -10 C254 40 276 90 260 150 C252 190 262 215 260 240" />
        </g>
        <g stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none">
          <path d="M-10 60 L364 50" />
          <path d="M-10 170 C100 176 220 160 364 176" />
          <path d="M200 -10 C206 60 194 130 204 240" />
        </g>
        <circle cx={cx} cy={cy} r={R} fill="#0f766e" fillOpacity="0.09" stroke="#0f766e" strokeWidth="2.5" strokeDasharray="7 6" />
        <circle cx={cx} cy={cy} r="15" fill="#2563eb" fillOpacity="0.2" />
        <circle cx={cx} cy={cy} r="7.5" fill="#2563eb" stroke="#fff" strokeWidth="3" />
        {ordered.map((p) => {
          const on = p.r.id === props.active;
          const fill = p.r.featured ? "#d97706" : on ? "#0b4f49" : "#0f766e";
          return (
            <g
              key={p.r.id}
              transform={`translate(${p.x.toFixed(1)},${(p.y - 40 * (on ? 1.15 : 0.85)).toFixed(1)}) scale(${on ? 1.15 : 0.85})`}
              onClick={() => props.onPick(p.r.id)}
              style={{ cursor: "pointer" }}
              data-testid="locator-pin"
            >
              <title>{p.r.name}</title>
              <path d="M0 0c-13 0-20 9-20 19 0 12 20 29 20 29s20-17 20-29c0-10-7-19-20-19z" fill={fill} stroke="#fff" strokeWidth="2.5" />
              <text x="0" y="25" textAnchor="middle" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="800" fontSize="16" fill="#fff">
                {p.n}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-ink-500">
        Illustrative map · you are the blue dot
      </div>
      {props.selected && (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2.5 rounded-2xl bg-white p-2.5 shadow-[0_10px_26px_-10px_rgba(7,41,39,0.55)]" data-testid="locator-best">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-ink-900">{props.selected.name}</p>
            <p className="truncate text-[11.5px] text-ink-500">
              {props.selected.distance_km < 0.1 ? "<0.1" : props.selected.distance_km.toFixed(1)} km · {props.selected.area}
              {(() => {
                const st = hoursStatus(props.selected.hours);
                return st ? ` · ${st.open ? "Open now" : "Closed now"}` : "";
              })()}
            </p>
          </div>
          <a
            href={directionsHref(props.selected.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 flex-none items-center rounded-xl bg-teal-700 px-4 text-[13px] font-extrabold text-white hover:bg-teal-800"
          >
            Directions
          </a>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  r,
  n,
  tab,
  active,
  onSelect,
}: {
  r: LocatorResult;
  n: number;
  tab: LocatorCategory;
  active: boolean;
  onSelect: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [more, setMore] = useState(false);
  const oriented = r.orientation_date ? new Date(r.orientation_date + "T00:00:00") : null;
  const orientedText =
    oriented && !Number.isNaN(oriented.getTime()) ? oriented.toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  const st = hoursStatus(r.hours);
  const closed = Boolean(st && !st.open);
  const lines = hoursLines(r.hours);
  const vacc = r.category === "vaccination" || tab === "vaccination";
  const checkedOn = r.last_verified ? new Date(r.last_verified + "T00:00:00") : null;
  const checkedText = checkedOn && !Number.isNaN(checkedOn.getTime()) ? checkedOn.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const vaccineTags = (r.vaccines ?? "").split(/[;,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  const timesLine = hoursSummary(r.hours);
  const vtype = r.vaccine_type ?? "government";
  const privateOnly = vacc && vtype === "private";

  async function share(e: React.MouseEvent) {
    e.stopPropagation();
    track("share", tab, { placeId: r.id });
    const url = `${window.location.origin}${directionsHref(r.id)}?s=1`;
    const text = shareText(r, url);
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: r.name, text });
        return;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return; // the person closed the share sheet
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }
  const initials = r.name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <li
      data-place={r.id}
      data-testid="locator-result"
      onClick={onSelect}
      className={`rounded-[24px] border bg-white p-3.5 shadow-[0_14px_34px_-26px_rgba(7,41,39,0.45)] transition ${
        active ? "border-teal-600 ring-2 ring-teal-200" : "border-[#d7e7e2]"
      } ${closed ? "opacity-80" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`relative grid h-12 w-12 flex-none place-items-center rounded-2xl text-[15px] font-extrabold text-white ${
            r.featured ? "bg-[#d97706]" : closed ? "bg-[#7b9490]" : "bg-teal-700"
          }`}
          title={`Pin ${n}`}
        >
          {initials || n}
          <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-extrabold text-teal-900 shadow ring-1 ring-[#d7e7e2]">
            {n}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-extrabold leading-snug text-ink-900">{r.name}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {kindLabel(r.kind)} · {r.area}
          </p>
        </div>
        <span className="flex-none rounded-xl bg-teal-50 px-2.5 py-1.5 text-[13px] font-extrabold text-teal-800">
          {r.distance_km < 0.1 ? "<0.1" : r.distance_km.toFixed(1)} km
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <HoursBadge hours={r.hours} />
        {r.featured && (
          <span className="rounded-full bg-[#fff0d6] px-2.5 py-0.5 text-[11px] font-extrabold text-[#8a5200]">Featured</span>
        )}
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
            tab === "autism" ? "bg-[#fff6e8] text-[#7a4a00]" : vacc ? "bg-[#e4f6dc] text-[#2d5a1f]" : r.verified ? "bg-[#e3f4f0] text-teal-900" : "bg-[#eef3f1] text-ink-600"
          }`}
        >
          {r.verified && tab !== "autism" ? "✓ " : ""}
          {trustLabel(r)}
          {tab === "autism" && orientedText ? ` · ${orientedText}` : ""}
        </span>
      </div>
      {vacc && (
        <div className="mt-2.5 space-y-1.5" data-testid="locator-vacc-details">
          <p className="text-[13px] font-semibold text-ink-800">{timesLine ?? "Timings not listed: please ask at the centre."}</p>
          {vaccineTags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Vaccines or age groups">
              {vaccineTags.map((v) => (
                <li key={v} className="rounded-full bg-[#f1f7ee] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#2d5a1f] ring-1 ring-[#d5e8cc]">
                  {v}
                </li>
              ))}
            </ul>
          )}
          {(vtype === "both" || privateOnly || r.service_fee) && (
            <div className="flex flex-wrap gap-1.5" data-testid="locator-vacc-badges">
              {vtype === "both" && (
                <span className="rounded-full bg-[#e6f0ff] px-2.5 py-0.5 text-[11px] font-extrabold text-[#1f4aa0]" data-testid="locator-badge-private-also">
                  Private vaccines also available
                </span>
              )}
              {privateOnly && (
                <span className="rounded-full bg-[#e6f0ff] px-2.5 py-0.5 text-[11px] font-extrabold text-[#1f4aa0]" data-testid="locator-badge-private">
                  Private vaccines
                </span>
              )}
              {r.service_fee && (
                <span className="rounded-full bg-[#fff4dc] px-2.5 py-0.5 text-[11px] font-extrabold text-[#7a4a00]" data-testid="locator-badge-fee">
                  Small service fee may apply
                </span>
              )}
            </div>
          )}
          <p className="text-[11.5px] leading-snug text-ink-500">
            {privateOnly ? "Listed by Family Medic" : "Listed from health department records"}
            {checkedText ? `, last checked ${checkedText}` : ""}. Timings can change{r.phone ? ", please call first" : ", please ask at the centre first"}.
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* The server counts the tap, then forwards to Google Maps with the exact pin. */}
        <a
          href={directionsHref(r.id)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="locator-directions"
          className="inline-flex min-h-11 flex-[1.4] items-center justify-center rounded-xl bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800"
        >
          Directions
        </a>
        {r.phone && (
          <a
            href={telHref(r.phone)}
            onClick={() => track("call_tap", tab, { placeId: r.id })}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#d9f3ee] px-5 text-sm font-extrabold text-teal-900 hover:bg-[#c8ece5]"
          >
            Call
          </a>
        )}
        {r.doctor_id && (
          <Link
            href={`/doctors/${r.doctor_id}`}
            onClick={() => track("book_tap", tab, { placeId: r.id })}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#ffb454] px-5 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272]"
          >
            Book online
          </Link>
        )}
        <button
          type="button"
          onClick={share}
          data-testid="locator-share"
          aria-label={`Share ${r.name}`}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#cfe0da] bg-white px-4 text-sm font-extrabold text-teal-900 hover:bg-[#f2f8f6]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4" />
          </svg>
          Share
        </button>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMore((v) => !v);
        }}
        aria-expanded={more}
        data-testid="locator-more"
        className="mt-2.5 text-[13px] font-extrabold text-teal-800"
      >
        {more ? "Less ▴" : "More ▾"}
      </button>
      {more && (
        <div className="mt-2 space-y-2 border-t border-[#e6efec] pt-3 text-sm text-ink-700" data-testid="locator-more-body">
          {r.address && <p>{r.address}</p>}
          {r.notes && <p>{r.notes}</p>}
          {vacc && r.source_note && <p className="text-xs text-ink-500">Source: {r.source_note}</p>}
          {lines.length > 1 && (
            <dl className="grid max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs" data-testid="locator-all-hours">
              {lines.map((l) => (
                <div key={l.day} className="contents">
                  <dt className="font-bold">{l.day}</dt>
                  <dd>{l.text}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReporting((v) => !v);
            }}
            className="text-xs font-bold text-teal-800 underline underline-offset-2"
          >
            Report a problem
          </button>
        </div>
      )}
      {reporting && <ReportBox placeId={r.id} autism={tab === "autism"} onClose={() => setReporting(false)} />}
    </li>
  );
}

// "Open now · until 9 pm" (green) or "Closed now · opens 9 am" (grey).
function HoursBadge({ hours }: { hours: LocatorResult["hours"] }) {
  const st = hoursStatus(hours);
  if (!st) return null;
  return (
    <span
      data-testid="locator-hours"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold ${st.open ? "bg-[#e1f5e6] text-[#1d6b34]" : "bg-[#eef1f0] text-ink-600"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${st.open ? "bg-[#2e9d4f]" : "bg-[#9aa8a4]"}`} aria-hidden="true" />
      {st.text}
    </span>
  );
}

function ReportBox({ placeId, autism, onClose }: { placeId: string; autism: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("wrong_info");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/locator/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, reason, note, website }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setState(res.ok && j.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-3 rounded-2xl bg-teal-50 p-3 text-sm font-semibold text-teal-900">
        Thank you. Our team will check this listing.{" "}
        <button onClick={onClose} className="underline">
          Close
        </button>
      </p>
    );
  }
  return (
    <form onSubmit={send} className="mt-3 grid gap-2 rounded-2xl bg-[#f3f9f7] p-3" onClick={(e) => e.stopPropagation()}>
      <label className="text-xs font-bold text-ink-700">
        What is wrong?
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[#cfe0da] bg-white px-3 py-2.5 text-sm font-semibold text-ink-900"
        >
          <option value="wrong_info">Wrong phone, address or timings</option>
          <option value="closed">It has closed or moved</option>
          {autism && <option value="not_autism_aware">It was not welcoming to us</option>}
          <option value="fake">This listing looks fake</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={400}
        placeholder="Tell us a little more (optional)"
        aria-label="More details"
        className="rounded-xl border border-[#cfe0da] bg-white px-3 py-2.5 text-sm"
      />
      <input
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        name="website"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "sending"}
          className="min-h-10 rounded-full bg-teal-700 px-5 text-sm font-extrabold text-white disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={onClose} className="text-sm font-bold text-ink-500 underline">
          Cancel
        </button>
      </div>
      {state === "error" && <p className="text-sm font-semibold text-red-700">Could not send. Please try again.</p>}
    </form>
  );
}

function ComingSoon({ tab, onPickKarachi }: { tab: LocatorCategory; onPickKarachi: () => void }) {
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [interest, setInterest] = useState<"doctor" | "autism" | "both">(tab === "autism" || tab === "doctor" ? tab : "both");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/locator/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, contact, interest, website }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        setState("done");
        return;
      }
      setMsg(
        j.error === "bad_contact"
          ? "Please enter a valid mobile number (with at least 10 digits) or an email address."
          : j.error === "slow_down"
            ? "Too many tries. Please wait a little and try again."
            : "Something went wrong. Please try again."
      );
      setState("error");
    } catch {
      setMsg("Something went wrong. Please check your connection and try again.");
      setState("error");
    }
  }

  return (
    <div
      className="mt-6 rounded-3xl bg-[radial-gradient(500px_220px_at_100%_0%,rgba(45,212,191,0.22),transparent_60%),linear-gradient(160deg,#0f766e,#0a3733)] p-6 text-white sm:p-8"
      data-testid="locator-coming-soon"
    >
      <span className="inline-flex rounded-full bg-[#ffb454] px-3 py-1 text-[11px] font-extrabold tracking-[0.14em] text-[#3b2500]">
        COMING SOON
      </span>
      <h2 className="mt-3 text-2xl font-extrabold">Not in your city yet</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-teal-50/90">
        The locator covers {SERVICE_AREA_TEXT} and is opening in more cities, step by step. Leave your city and a mobile number or
        email, and we will let you know when it reaches you.
      </p>
      {state === "done" ? (
        <p className="mt-5 rounded-2xl bg-white/10 p-4 text-sm font-semibold">
          Thank you. We will contact you when the locator reaches your city.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Your city"
            maxLength={60}
            aria-label="Your city"
            className="rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm text-ink-900 outline-none"
          />
          <input
            required
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Mobile number or email"
            maxLength={120}
            aria-label="Mobile number or email"
            className="rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm text-ink-900 outline-none"
          />
          <select
            value={interest}
            onChange={(e) => setInterest(e.target.value as "doctor" | "autism" | "both")}
            aria-label="What are you interested in?"
            className="rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm text-ink-900 outline-none sm:col-span-2"
          >
            <option value="doctor">Doctors, clinics, pharmacies, therapy &amp; rehab</option>
            <option value="autism">Autism-aware places</option>
            <option value="both">Both</option>
          </select>
          {/* honeypot: real people never see or fill this */}
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            name="website"
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-full bg-white px-6 py-3 text-sm font-extrabold text-[#0a3733] hover:bg-[#ffb454] disabled:opacity-60"
            >
              {state === "sending" ? "Sending…" : "Notify me"}
            </button>
            <button type="button" onClick={onPickKarachi} className="text-sm font-bold text-teal-100 underline underline-offset-2">
              I am in one of these cities: pick my area instead
            </button>
          </div>
          {state === "error" && <p className="text-sm font-semibold text-[#ffd9a0] sm:col-span-2">{msg}</p>}
        </form>
      )}
    </div>
  );
}
