"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  AUTISM_DISCLAIMER,
  CATEGORY_LABEL,
  DOCTOR_DISCLAIMER,
  KARACHI_AREAS,
  KINDS,
  PILOT,
  RADII,
  TILES,
  directionsHref,
  hoursLines,
  hoursStatus,
  inPilot,
  kindLabel,
  telHref,
  trustLabel,
  type LocatorCategory,
  type LocatorResult,
  type Origin,
} from "@/lib/locator";

// Family Medic Locator (migrations 0095 + 0096), Karachi pilot. Design "C": three big tiles,
// a category screen for Autism-Aware Places, and results with a numbered pin map.
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
type Counts = { doctor: number; pharmacy: number; therapy: number; autism: number };

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
    tabParam === "autism" || tabParam === "therapy" || tabParam === "doctor" || tabParam === "pharmacy" ? tabParam : null;
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
      const d = data as { live?: boolean; doctor?: number; pharmacy?: number; therapy?: number; autism?: number };
      setLive(d.live !== false);
      setCounts({ doctor: Number(d.doctor ?? 0), pharmacy: Number(d.pharmacy ?? 0), therapy: Number(d.therapy ?? 0), autism: Number(d.autism ?? 0) });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const originLabel = (o: Origin) => (o.kind === "area" ? o.area : "My location");

  const runSearch = useCallback(async (o: Origin, cat: LocatorCategory, r: number, k: string) => {
    if (!supabase) {
      setPhase("error");
      return;
    }
    const id = ++reqId.current;
    setPhase("searching");
    setActive(null);
    track("search", cat);
    const { data, error } = await supabase.rpc("locator_search", {
      p_lat: o.lat,
      p_lng: o.lng,
      p_radius_km: r,
      p_category: cat,
      p_kind: k || null,
    });
    if (id !== reqId.current) return; // a newer search replaced this one
    if (error) {
      setPhase("error");
      return;
    }
    const rows = ((data ?? []) as LocatorResult[]).map((x) => ({
      ...x,
      distance_km: Number(x.distance_km),
      map_lat: x.map_lat === null ? null : Number(x.map_lat),
      map_lng: x.map_lng === null ? null : Number(x.map_lng),
    }));
    setResults(rows);
    if (!k) {
      const c: Record<string, number> = {};
      for (const x of rows) c[x.kind] = (c[x.kind] ?? 0) + 1;
      setKindCounts(c);
    }
    setPhase("done");
    const area = o.kind === "area" ? o.area : "My location";
    if (rows.length) track("results", cat, { ids: rows.map((x) => x.id), area });
    else track("empty", cat, { area });
  }, []);

  function setOriginAndSearch(o: Origin) {
    setOutside(false);
    setOrigin(o);
    if (screen !== "home") runSearch(o, tab, radius, kind);
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
        if (screen !== "home") runSearch(o, tab, radius, kind);
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
    const a = KARACHI_AREAS.find((x) => x.name === name);
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
    if (origin && !outside) runSearch(origin, cat, radius, "");
  }

  function openKind(k: string) {
    setKind(k);
    setScreen("results");
    if (origin && !outside) runSearch(origin, tab, radius, k);
  }

  function changeRadius(r: number) {
    setRadius(r);
    if (origin && !outside) runSearch(origin, tab, r, kind);
  }

  function changeKind(k: string) {
    setKind(k);
    if (origin && !outside) runSearch(origin, tab, radius, k);
  }

  function back() {
    if (screen === "results" && tab === "autism" && kind) {
      setKind("");
      setScreen("category");
      if (origin && !outside) runSearch(origin, tab, radius, "");
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

        <p className="mt-5 text-xs font-extrabold tracking-[0.16em] text-teal-700">WHAT ARE YOU LOOKING FOR?</p>
        <div className="mt-3 flex flex-col gap-3">
          {TILES.map((t) => (
            <button
              key={t.category}
              onClick={() => openTile(t.category)}
              data-testid={`locator-tile-${t.category}`}
              className="flex min-h-24 items-center gap-4 rounded-[26px] border border-[#d7e7e2] bg-white p-4 text-left shadow-[0_18px_34px_-26px_rgba(7,41,39,0.6)] transition hover:border-teal-600 sm:p-5"
            >
              <span
                className="grid h-[60px] w-[60px] flex-none place-items-center rounded-[20px]"
                style={{
                  background:
                    t.category === "doctor"
                      ? "linear-gradient(135deg,#e3f4f0,#c5ebe3)"
                      : t.category === "pharmacy"
                        ? "linear-gradient(135deg,#e4f6e8,#c6ebcf)"
                        : t.category === "therapy"
                        ? "linear-gradient(135deg,#e8eefc,#d2defa)"
                        : "linear-gradient(135deg,#fff3dc,#ffe2ad)",
                }}
              >
                <TileIcon category={t.category} />
              </span>
              <span className="flex-1">
                <span className="block text-lg font-extrabold text-ink-900">{t.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{t.blurb}</span>
                {counts && counts[t.category] > 0 && (
                  <span className="mt-1 block text-xs font-bold text-teal-700">
                    {counts[t.category]} {counts[t.category] === 1 ? "place" : "places"} listed
                  </span>
                )}
              </span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ))}
        </div>

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
  const title = kind ? (kinds.find((k) => k.value === kind)?.label ?? CATEGORY_LABEL[tab]) : CATEGORY_LABEL[tab];
  const anyHours = results.some((r) => r.hours);
  const shown = openOnly ? results.filter((r) => hoursStatus(r.hours)?.open) : results;
  const hasMap = Boolean(origin && !outside && phase === "done" && shown.length > 0);
  const typeChips =
    origin && !outside && (kinds.length > 1 || anyHours) ? (
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
            ? `${shown.length === 0 ? "Nothing listed yet" : `${shown.length} ${shown.length === 1 ? "place" : "places"}`} within ${radius} km of ${origin.kind === "area" ? origin.area : "you"}`
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
              {counts[tab]} {counts[tab] === 1 ? "place is" : "places are"} listed so far in {PILOT.city}.
            </p>
          )}
        </div>
      )}
      {outside && <ComingSoon tab={tab} onPickKarachi={() => setOutside(false)} />}

      {hasMap && origin && <PinMap origin={origin} results={shown} radius={radius} active={active} onPick={pickPin} />}
      {typeChips}

      {origin && !outside && (
        <div className="mt-4" aria-live="polite">
          {(phase === "searching" || phase === "locating") && <p className="text-sm text-ink-500">Looking nearby…</p>}
          {phase === "error" && (
            <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">
              Something went wrong while searching. Please try again in a moment.
            </p>
          )}
          {phase === "done" && shown.length > 0 && (
            <ul ref={listRef} className="space-y-3">
              {shown.map((r, i) => (
                <ResultCard key={r.id} r={r} n={i + 1} tab={tab} active={active === r.id} onSelect={() => setActive(r.id)} />
              ))}
            </ul>
          )}
          {phase === "done" && shown.length === 0 && openOnly && results.length > 0 && (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink-700" data-testid="locator-none-open">
              Nothing with opening hours is open right now within {radius} km. Switch off &ldquo;Open now&rdquo; to see everything.
            </p>
          )}
          {phase === "done" && shown.length === 0 && !(openOnly && results.length > 0) && (
            <div className="rounded-2xl border border-dashed border-[#bcd8d0] bg-white p-6 text-sm text-ink-700" data-testid="locator-empty">
              <p className="font-bold text-ink-900">We have not listed anything here yet.</p>
              <p className="mt-1">
                This is a new pilot and we add places every week. {radius < 5 ? "Try a wider distance, or " : ""}
                {tab === "autism"
                  ? "if you know a barber shop, restaurant, shop or school that is kind to autistic families, tell us and we will invite them."
                  : "if you run a clinic, pharmacy or therapy centre, you can list it."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {radius < 5 && (
                  <button
                    onClick={() => changeRadius(5)}
                    className="inline-flex rounded-full border border-teal-700 px-5 py-2.5 text-sm font-extrabold text-teal-800 hover:bg-teal-50"
                  >
                    Try 5 km
                  </button>
                )}
                <Link
                  href={tab === "autism" ? "/locator/suggest?tab=autism" : "/locator/list"}
                  className="inline-flex rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-800"
                >
                  {tab === "autism" ? "Suggest a place" : "List your workplace"}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {tab !== "autism" && <ListYourWorkplace />}
      <Footer tab={tab} />
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
  return (
    <svg {...common} stroke="#a15c00" aria-hidden="true">
      <path d="M12 12c-2-3.5-6-3.5-6 0 0 3.5 4 3.5 6 0 2-3.5 6-3.5 6 0 0 3.5-4 3.5-6 0z" />
    </svg>
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
          <div className="flex gap-1.5" role="group" aria-label="Distance">
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => props.onRadius(r)}
                aria-pressed={props.radius === r}
                data-testid={`locator-radius-${r}`}
                className={`rounded-full px-3 py-2 text-xs font-extrabold ${
                  props.radius === r ? "bg-[#ffb454] text-[#3b2500]" : "bg-white/15 text-white"
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
          <span className="sr-only">Pick your area in Karachi</span>
          <select
            value={props.origin?.kind === "area" ? props.origin.area : ""}
            onChange={(e) => props.onArea(e.target.value)}
            data-testid="locator-area"
            className="min-h-11 w-full rounded-full border border-[#cfe0da] bg-white px-4 py-3 text-sm font-semibold text-ink-900 outline-none focus:border-teal-600"
          >
            <option value="">Pick your area in Karachi…</option>
            {KARACHI_AREAS.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
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

function Footer({ tab }: { tab: LocatorCategory }) {
  return (
    <p className="mt-5 text-xs leading-relaxed text-ink-500">{tab === "autism" ? AUTISM_DISCLAIMER : DOCTOR_DISCLAIMER}</p>
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
      className="relative -mt-[52px] h-[230px] overflow-hidden rounded-[26px] border border-[#d7e7e2] bg-[#e6f0ea] shadow-[0_20px_38px_-26px_rgba(7,41,39,0.65)]"
      data-testid="locator-map"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Illustrative map with numbered pins for each result" preserveAspectRatio="xMidYMid slice">
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
      <div className="absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-ink-500">
        Illustrative map · you are the blue dot
      </div>
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
  const oriented = r.orientation_date ? new Date(r.orientation_date + "T00:00:00") : null;
  const orientedText =
    oriented && !Number.isNaN(oriented.getTime()) ? oriented.toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  return (
    <li
      data-place={r.id}
      data-testid="locator-result"
      onClick={onSelect}
      className={`rounded-[22px] border bg-white p-3.5 shadow-[0_14px_34px_-26px_rgba(7,41,39,0.45)] transition ${
        active ? "border-teal-600 ring-2 ring-teal-200" : "border-[#d7e7e2]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-9 w-9 flex-none place-items-center rounded-full text-base font-extrabold text-white ${
            r.featured ? "bg-[#d97706]" : "bg-teal-700"
          }`}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-extrabold text-ink-900 sm:text-base">{r.name}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {kindLabel(r.kind)} · {r.area}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {r.featured && (
              <span className="rounded-full bg-[#fff0d6] px-2.5 py-0.5 text-[11px] font-extrabold text-[#8a5200]">Featured</span>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                tab === "autism" ? "bg-[#fff6e8] text-[#7a4a00]" : r.verified ? "bg-[#e3f4f0] text-teal-900" : "bg-[#eef3f1] text-ink-600"
              }`}
            >
              {trustLabel(r)}
              {tab === "autism" && orientedText ? ` · ${orientedText}` : ""}
            </span>
          </div>
        </div>
        <span className="flex-none rounded-full bg-teal-50 px-2.5 py-1.5 text-[13px] font-extrabold text-teal-800">
          {r.distance_km < 0.1 ? "<0.1" : r.distance_km.toFixed(1)} km
        </span>
      </div>
      {r.address && <p className="mt-2 text-sm text-ink-700">{r.address}</p>}
      <HoursLine hours={r.hours} />
      {r.notes && <p className="mt-1 text-sm text-ink-700">{r.notes}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* The server counts the tap, then forwards to Google Maps with the exact pin. */}
        <a
          href={directionsHref(r.id)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="locator-directions"
          className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-5 text-sm font-extrabold text-white hover:bg-teal-800"
        >
          Directions
        </a>
        {r.phone && (
          <a
            href={telHref(r.phone)}
            onClick={() => track("call_tap", tab, { placeId: r.id })}
            className="inline-flex min-h-11 items-center rounded-full border border-teal-700 px-5 text-sm font-extrabold text-teal-800 hover:bg-teal-50"
          >
            Call
          </a>
        )}
        {r.doctor_id && (
          <Link
            href={`/doctors/${r.doctor_id}`}
            onClick={() => track("book_tap", tab, { placeId: r.id })}
            className="inline-flex min-h-11 items-center rounded-full bg-[#ffb454] px-5 text-sm font-extrabold text-[#3b2500] hover:bg-[#ffc272]"
          >
            Book online
          </Link>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setReporting((v) => !v);
          }}
          className="ml-auto text-xs font-bold text-teal-800 underline underline-offset-2"
        >
          Report a problem
        </button>
      </div>
      {reporting && <ReportBox placeId={r.id} autism={tab === "autism"} onClose={() => setReporting(false)} />}
    </li>
  );
}

// "Open now · until 9 pm" (green) or "Closed now · opens 9 am" (grey), with the full week one tap away.
function HoursLine({ hours }: { hours: LocatorResult["hours"] }) {
  const [full, setFull] = useState(false);
  const st = hoursStatus(hours);
  if (!st) return null;
  const lines = hoursLines(hours);
  return (
    <div className="mt-2 text-sm" data-testid="locator-hours">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${st.open ? "bg-[#e1f5e6] text-[#1d6b34]" : "bg-[#eef1f0] text-ink-600"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${st.open ? "bg-[#2e9d4f]" : "bg-[#9aa8a4]"}`} aria-hidden="true" />
        {st.text}
      </span>
      {lines.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFull((v) => !v);
          }}
          aria-expanded={full}
          className="ml-2 text-xs font-bold text-teal-800 underline underline-offset-2"
        >
          {full ? "Hide hours" : "All hours"}
        </button>
      )}
      {full && (
        <dl className="mt-1.5 grid max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs text-ink-700">
          {lines.map((l) => (
            <div key={l.day} className="contents">
              <dt className="font-bold">{l.day}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
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
      <h2 className="mt-3 text-2xl font-extrabold">We are starting in Karachi</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-teal-50/90">
        The locator is in its pilot in {PILOT.city} and will open in more cities, step by step. Leave your city and a mobile number or
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
              I am in Karachi: pick my area instead
            </button>
          </div>
          {state === "error" && <p className="text-sm font-semibold text-[#ffd9a0] sm:col-span-2">{msg}</p>}
        </form>
      )}
    </div>
  );
}
