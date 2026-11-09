// Family Medic Locator (migration 0095), Karachi pilot.
//
// Shared by the public page, the "suggest a place" form, the API routes and the
// admin screen. Nothing here calls a paid map service: distance is worked out
// in the database from plain coordinates, and "Directions" is just a Google
// Maps search link.

export type LocatorCategory = "doctor" | "therapy" | "autism";

export const CATEGORY_LABEL: Record<LocatorCategory, string> = {
  doctor: "Doctors & Clinics",
  therapy: "Therapy & Rehab",
  autism: "Autism-Aware Places",
};

// The three big tiles on the home screen, in the order the owner asked for.
export const TILES: { category: LocatorCategory; title: string; blurb: string }[] = [
  { category: "doctor", title: "Doctors & Clinics", blurb: "Clinics, hospitals, pharmacies and labs" },
  { category: "therapy", title: "Therapy & Rehab", blurb: "Autism therapy, speech, physio and more" },
  { category: "autism", title: "Autism-Aware Places", blurb: "Barbers, restaurants, shops and parks that welcome autistic families" },
];

export const KINDS: Record<LocatorCategory, { value: string; label: string }[]> = {
  doctor: [
    { value: "clinic", label: "Clinic" },
    { value: "doctor", label: "Family doctor" },
    { value: "hospital", label: "Hospital" },
    { value: "lab", label: "Lab" },
    { value: "pharmacy", label: "Pharmacy" },
  ],
  therapy: [
    { value: "autism_therapy", label: "Autism therapy centre" },
    { value: "speech", label: "Speech therapy" },
    { value: "occupational", label: "Occupational therapy" },
    { value: "physio", label: "Physiotherapy" },
    { value: "psychology", label: "Psychology / counselling" },
    { value: "rehab", label: "Rehab centre" },
  ],
  autism: [
    { value: "barber", label: "Barber shop" },
    { value: "salon", label: "Salon" },
    { value: "restaurant", label: "Restaurant" },
    { value: "cafe", label: "Cafe" },
    { value: "market", label: "Market / shop" },
    { value: "mall", label: "Mall" },
    { value: "park", label: "Park / play area" },
    { value: "school", label: "School" },
    { value: "other", label: "Other" },
  ],
};

// Types an owner can register (kind -> which tab it lands in). Fees and "needs verification"
// come from the database (locator_fees, admin-editable); these are only the fallbacks.
export const OWNER_KINDS: { value: string; label: string; category: "doctor" | "therapy"; fee: number; verify: boolean }[] = [
  { value: "clinic", label: "Clinic", category: "doctor", fee: 1500, verify: true },
  { value: "doctor", label: "Family doctor / consultant", category: "doctor", fee: 1000, verify: true },
  { value: "hospital", label: "Hospital", category: "doctor", fee: 1500, verify: true },
  { value: "lab", label: "Lab", category: "doctor", fee: 1500, verify: true },
  { value: "pharmacy", label: "Pharmacy", category: "doctor", fee: 1000, verify: false },
  { value: "autism_therapy", label: "Autism therapy centre", category: "therapy", fee: 1500, verify: true },
  { value: "rehab", label: "Rehab centre", category: "therapy", fee: 1500, verify: true },
  { value: "physio", label: "Physiotherapist / clinic", category: "therapy", fee: 1000, verify: true },
  { value: "speech", label: "Speech therapist", category: "therapy", fee: 1000, verify: true },
  { value: "occupational", label: "Occupational therapist", category: "therapy", fee: 1000, verify: true },
  { value: "psychology", label: "Psychologist / counsellor", category: "therapy", fee: 1000, verify: true },
];

export function ownerKindCategory(kind: string): "doctor" | "therapy" | null {
  return OWNER_KINDS.find((k) => k.value === kind)?.category ?? null;
}

export const PROOF_MAX_BYTES = 3_500_000;
export const PROOF_MAX_FILES = 6;
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export function kindLabel(kind: string): string {
  for (const list of Object.values(KINDS)) {
    const hit = list.find((k) => k.value === kind);
    if (hit) return hit.label;
  }
  return kind;
}

export const RADII = [2, 3, 5] as const;

// The pilot box. The database enforces the same numbers.
export const PILOT = {
  city: "Karachi",
  latMin: 24.75,
  latMax: 25.15,
  lngMin: 66.85,
  lngMax: 67.45,
};

export function inPilot(lat: number, lng: number): boolean {
  return lat >= PILOT.latMin && lat <= PILOT.latMax && lng >= PILOT.lngMin && lng <= PILOT.lngMax;
}

// Rough centre of each area, for people who would rather pick an area than share
// their location. These are approximate on purpose: the result list says "near
// <area>" and the distances are from that centre point.
export const KARACHI_AREAS: { name: string; lat: number; lng: number }[] = [
  { name: "Saddar", lat: 24.8607, lng: 67.0100 },
  { name: "Clifton", lat: 24.8138, lng: 67.03 },
  { name: "DHA (Defence)", lat: 24.8, lng: 67.06 },
  { name: "Karachi Cantt", lat: 24.862, lng: 67.0355 },
  { name: "PECHS", lat: 24.867, lng: 67.0556 },
  { name: "Tariq Road", lat: 24.871, lng: 67.064 },
  { name: "Bahadurabad", lat: 24.883, lng: 67.068 },
  { name: "Shahrah-e-Faisal / Karsaz", lat: 24.868, lng: 67.087 },
  { name: "Gulshan-e-Iqbal", lat: 24.9215, lng: 67.092 },
  { name: "Gulistan-e-Johar", lat: 24.918, lng: 67.128 },
  { name: "Nazimabad", lat: 24.912, lng: 67.031 },
  { name: "North Nazimabad", lat: 24.94, lng: 67.04 },
  { name: "Liaquatabad", lat: 24.91, lng: 67.048 },
  { name: "Federal B Area", lat: 24.938, lng: 67.089 },
  { name: "North Karachi", lat: 24.98, lng: 67.07 },
  { name: "Surjani Town", lat: 25.03, lng: 67.03 },
  { name: "Orangi Town", lat: 24.95, lng: 66.99 },
  { name: "Lyari", lat: 24.86, lng: 66.99 },
  { name: "Korangi", lat: 24.83, lng: 67.12 },
  { name: "Landhi", lat: 24.853, lng: 67.202 },
  { name: "Malir", lat: 24.894, lng: 67.206 },
  { name: "Model Colony", lat: 24.898, lng: 67.186 },
  { name: "Scheme 33", lat: 24.99, lng: 67.135 },
  { name: "Gulshan-e-Maymar", lat: 25.02, lng: 67.14 },
  { name: "Gadap / Super Highway", lat: 25.0, lng: 67.18 },
];

export interface LocatorResult {
  id: string;
  category: LocatorCategory;
  kind: string;
  name: string;
  area: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  doctor_id: string | null;
  orientation_date: string | null;
  distance_km: number;
  // Position rounded to about 100 m: enough to draw the numbered pins, never the exact door.
  map_lat: number | null;
  map_lng: number | null;
  verified: boolean;
  verified_on: string | null;
  featured: boolean;
}

// What the listing tells a visitor about checking: only claims we actually made.
export function trustLabel(r: Pick<LocatorResult, "category" | "verified">): string {
  if (r.category === "autism") return "Autism-Aware Place";
  return r.verified ? "Documents checked by Family Medic" : "Listed";
}

// The counted Directions link: our server counts the tap, then forwards to Google Maps with
// the exact pin. Falls back to a plain Google Maps search when we have no id.
export function directionsHref(id: string): string {
  return `/api/locator/go/${encodeURIComponent(id)}`;
}

export function mapsDirectionsUrl(p: { name: string; area: string; address?: string | null }): string {
  const q = [p.name, p.address || p.area, "Karachi"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// Pakistani numbers -> tel: digits (keeps a leading +).
export function telHref(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  return `tel:${d}`;
}

// Admin convenience: paste a Google Maps link and pull the coordinates out of it.
// Handles ".../@24.8138,67.0300,17z", "...?q=24.8138,67.0300" and "!3d24.8138!4d67.0300".
// Short links (maps.app.goo.gl) cannot be read without opening them, so those return null.
export function coordsFromMapsLink(text: string): { lat: number; lng: number } | null {
  const s = text.trim();
  const pats = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|center)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

// Where a person is asking from, in plain words for the results line.
export type Origin =
  | { kind: "gps"; lat: number; lng: number }
  | { kind: "area"; lat: number; lng: number; area: string };

export const AUTISM_DISCLAIMER =
  "Autism-aware means the team has received a short orientation from volunteers of the Vulnerable Women and Children Organization (VWCO). It is not a medical certification or a guarantee. Every family and every day is different, so please call ahead if you need a quiet time or specific help.";

export const DOCTOR_DISCLAIMER =
  "Listings are for finding a place near you, not a recommendation or endorsement. In an emergency, go to the nearest hospital or call 1122.";
