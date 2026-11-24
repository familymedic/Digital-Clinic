// Vaccination centres (migration 0100): reading an admin's Excel / CSV sheet into rows the database
// accepts. Pure functions, no network: Google Maps short links that need opening are only
// reported back (needsResolve) so the admin screen can ask the server to open them.
//
// The sheet's own column names are matched loosely (see ALIASES), times may be written as
// "9am", "09:00", "2:30 pm" or as Excel time cells, and days as "Mon-Sat", "Monday to Friday",
// "Mon, Wed, Fri" or "Daily". Nothing is guessed: a row with no usable location is reported and
// skipped, and opening hours without days are left out with a warning.

import { DAY_KEYS, coordsFromMapsLink, type DayKey, type OpenHours, type TimeRange } from "./locator";

export type VaccField =
  | "name" | "district" | "area" | "uc" | "address" | "lat" | "lng" | "maps" | "open" | "close" | "timings"
  | "days" | "friopen" | "friclose" | "vtype" | "fee" | "vaccines" | "phone" | "type" | "source" | "verified";

// header (lower case, letters and digits only) -> field
const ALIASES: Record<VaccField, string[]> = {
  name: ["centrename", "centername", "name", "centre", "center", "vaccinationcentre", "vaccinationcenter", "facility", "facilityname", "site", "sitename", "centrenameandtype"],
  district: ["district"],
  area: ["townoruc", "townuc", "town", "area", "locality", "tehsil", "taluka", "areaname"],
  uc: ["uc", "unioncouncil", "ucname", "ucno"],
  address: ["address", "fulladdress", "location", "streetaddress"],
  lat: ["latitude", "lat"],
  lng: ["longitude", "lng", "long", "lon"],
  maps: ["googlemapslink", "mapslink", "maplink", "googlemap", "googlemaps", "locationlink", "gpslink", "link", "maps", "mapurl", "mapsurl"],
  open: ["openingtime", "opentime", "opens", "open", "starttime", "from", "timefrom", "opening"],
  close: ["closingtime", "closetime", "closes", "close", "endtime", "to", "timeto", "closing"],
  timings: ["timings", "timing", "hours", "openinghours", "time", "dutyhours", "workinghours", "clinictimings"],
  friopen: ["fridayopeningtime", "fridayopentime", "fridayopens", "fridayopening", "fridaystart", "fridayfrom", "jummaopening", "jumaopening"],
  friclose: ["fridayclosingtime", "fridayclosetime", "fridaycloses", "fridayclosing", "fridayend", "fridayto", "jummaclosing", "jumaclosing"],
  vtype: ["vaccinesoffered", "vaccinetype", "vaccinesource", "vaccinetypeoffered", "vaccinetypes", "typeofvaccine", "typeofvaccines"],
  fee: ["servicefee", "servicecharge", "servicefeeapplies", "nominalservicefee", "servicefeeyesno", "servicechargeapplies"],
  days: ["daysopen", "days", "workingdays", "opendays", "dayopen", "day"],
  vaccines: ["vaccinesorreagegroups", "vaccinesoragegroups", "vaccines", "vaccine", "services", "agegroups", "vaccinesavailable", "vaccinesprovided"],
  phone: ["centrephone", "centerphone", "phone", "contact", "contactnumber", "mobile", "phonenumber", "contactno", "phoneno"],
  type: ["centretype", "centertype", "type", "facilitytype", "category"],
  source: ["sourcenote", "source", "datasource"],
  verified: ["lastverifieddate", "lastverified", "verifiedon", "verified", "dateverified", "lastupdated", "updated"],
};

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIAS_TO_FIELD = new Map<string, VaccField>();
(Object.keys(ALIASES) as VaccField[]).forEach((f) => ALIASES[f].forEach((a) => { if (!ALIAS_TO_FIELD.has(a)) ALIAS_TO_FIELD.set(a, f); }));

export function fieldForHeader(h: unknown): VaccField | null {
  return ALIAS_TO_FIELD.get(norm(h)) ?? null;
}

// ------------------------------------------------------------------ CSV (when the file is not .xlsx)
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------ times
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad(h % 24)}:${pad(m)}`;

interface ParsedTime { t: string; hour12Guess: boolean; hadMeridiem: boolean; rawHour: number }

function parseTimeDetail(v: unknown): ParsedTime | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel time cells arrive as a date on the Excel epoch; the clock part is stored in UTC.
    return { t: hhmm(v.getUTCHours(), v.getUTCMinutes()), hour12Guess: false, hadMeridiem: true, rawHour: v.getUTCHours() };
  }
  if (typeof v === "number") {
    if (v >= 0 && v < 1) {
      const mins = Math.round(v * 24 * 60);
      return { t: hhmm(Math.floor(mins / 60), mins % 60), hour12Guess: false, hadMeridiem: true, rawHour: Math.floor(mins / 60) };
    }
    if (Number.isInteger(v) && v >= 0 && v <= 24) return { t: hhmm(v, 0), hour12Guess: true, hadMeridiem: false, rawHour: v };
    return null;
  }
  let s = String(v).trim().toLowerCase().replace(/(\d)\.(\d{2})\b/, "$1:$2").replace(/\./g, "");
  if (s === "noon" || s === "12 noon") return { t: "12:00", hour12Guess: false, hadMeridiem: true, rawHour: 12 };
  if (s === "midnight") return { t: "00:00", hour12Guess: false, hadMeridiem: true, rawHour: 0 };
  s = s.replace(/\s+/g, " ");
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a m|p m)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (mm > 59) return null;
  const mer = m[3] ? (m[3].startsWith("p") ? "pm" : "am") : null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return { t: hhmm(h, mm), hour12Guess: false, hadMeridiem: true, rawHour: Number(m[1]) };
  }
  if (h > 24 || (h === 24 && mm > 0)) return null;
  return { t: hhmm(h === 24 ? 0 : h, mm), hour12Guess: h >= 1 && h <= 12, hadMeridiem: false, rawHour: h };
}

export function parseTime(v: unknown): string | null {
  return parseTimeDetail(v)?.t ?? null;
}

// "9am to 2pm", "09:00-14:00", "9 - 2". Returns null when it is not a range.
export function splitRange(v: unknown): [string, string] | null {
  if (typeof v !== "string") return null;
  const parts = v.split(/\s*(?:-|–|—|to|till|until)\s*/i);
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  return [parts[0].trim(), parts[1].trim()];
}

// ------------------------------------------------------------------ days
const DAY_WORDS: Record<string, DayKey> = {
  mon: "mon", monday: "mon", tue: "tue", tues: "tue", tuesday: "tue", wed: "wed", weds: "wed", wednesday: "wed",
  thu: "thu", thur: "thu", thurs: "thu", thursday: "thu", fri: "fri", friday: "fri", sat: "sat", saturday: "sat",
  sun: "sun", sunday: "sun",
};

// null when the text cannot be understood (never a guess)
export function parseDays(v: unknown): DayKey[] | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (/^(daily|every ?day|all days|7 days|all week|everyday|24\/7)$/.test(s)) return [...DAY_KEYS];
  if (/^(mon(day)?\s*(-|–|to|till)\s*sat(urday)?)$/.test(s)) return DAY_KEYS.slice(0, 6);
  const out = new Set<DayKey>();
  const tokens = s.split(/\s*(?:,|&|\+|\/|\band\b)\s*/).filter(Boolean);
  if (!tokens.length) return null;
  for (const tok of tokens) {
    const r = tok.split(/\s*(?:-|–|—|\bto\b|\btill\b|\bthrough\b)\s*/).filter(Boolean);
    if (r.length === 1) {
      const d = DAY_WORDS[r[0].replace(/[^a-z]/g, "")];
      if (!d) return null;
      out.add(d);
    } else if (r.length === 2) {
      const a = DAY_WORDS[r[0].replace(/[^a-z]/g, "")];
      const b = DAY_WORDS[r[1].replace(/[^a-z]/g, "")];
      if (!a || !b) return null;
      let i = DAY_KEYS.indexOf(a);
      const end = DAY_KEYS.indexOf(b);
      for (let n = 0; n < 7; n++) {
        out.add(DAY_KEYS[i]);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else return null;
  }
  return DAY_KEYS.filter((d) => out.has(d));
}

// ------------------------------------------------------------------ one row
export interface VaccPayload {
  name: string;
  district: string | null;
  area: string | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  vaccines: string | null;
  source_note: string | null;
  last_verified: string | null;
  lat: number | null;
  lng: number | null;
  hours: OpenHours | null;
  // "government" | "private" | "both". Undefined = the sheet has no such column (the database then says government);
  // null = the column exists but this cell is empty or not understood (the database reports the row).
  vaccine_type?: string | null;
  service_fee?: boolean;
}

export interface ParsedRow {
  line: number;            // row number in the sheet (header is row 1 or later)
  payload: VaccPayload;
  warnings: string[];
  needsResolve: string | null; // a Google Maps short link the server must open
  raw: Record<string, unknown>;
}

const txt = (v: unknown): string | null => {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, " ").trim();
  return s ? s : null;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function dateText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // dd/mm/yyyy (Pakistan)
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return null;
}

export function buildHours(days: DayKey[], open: string, close: string): OpenHours {
  const d: Partial<Record<DayKey, TimeRange[]>> = {};
  for (const k of days) d[k] = [[open, close]];
  return { days: d };
}

// What staff write for "vaccines offered". Government = the government (EPI) vaccine, Private = private vaccines only,
// Both = centres that give the government vaccine and also offer private ones.
export function parseVaccineType(v: unknown): string | null {
  const t = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!t) return null;
  if (/^(both|government and private|govt and private|gov and private|government private|govt private|private and government|private and govt)( vaccines?)?$/.test(t)) return "both";
  if (/^(government|govt|gov|public|epi)( vaccines?)?$/.test(t)) return "government";
  if (/^private( vaccines?)?$/.test(t)) return "private";
  return null;
}

export function parseYes(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  const t = String(v ?? "").trim().toLowerCase();
  return t === "yes" || t === "y" || t === "true" || t === "1" || t === "✓" || t === "x";
}

export function parseRow(raw: Record<string, unknown>, line: number, opts: { vtypeColumn?: boolean } = {}): ParsedRow {
  const warnings: string[] = [];
  const name = txt(raw.name) ?? "";
  let lat = numOrNull(raw.lat);
  let lng = numOrNull(raw.lng);
  let needsResolve: string | null = null;

  // location: columns first, then any Google Maps link (also a link typed into the lat/lng cells)
  if (lat == null || lng == null) {
    lat = null;
    lng = null;
    const candidates = [txt(raw.maps), txt(raw.lat), txt(raw.lng), txt(raw.address)].filter((x): x is string => !!x);
    const both = txt(raw.lat) && txt(raw.lng) ? `${txt(raw.lat)}, ${txt(raw.lng)}` : null;
    if (both) candidates.unshift(both);
    for (const c of candidates) {
      const hit = coordsFromMapsLink(c);
      if (hit) { lat = hit.lat; lng = hit.lng; break; }
    }
    if (lat == null) {
      const link = candidates.find((c) => /^https?:\/\//i.test(c));
      if (link) needsResolve = link;
    }
  }

  // a pin written longitude-first (67.09, 24.92) is swapped back; Pakistan has latitude below 40 and longitude above 60
  if (lat != null && lng != null && lat > 60 && lng < 40) {
    [lat, lng] = [lng, lat];
    warnings.push("Latitude and longitude looked swapped, corrected");
  }

  // opening hours
  let hours: OpenHours | null = null;
  let openRaw: unknown = raw.open;
  let closeRaw: unknown = raw.close;
  const range = openRaw == null && closeRaw == null ? splitRange(raw.timings) : null;
  if (range) { openRaw = range[0]; closeRaw = range[1]; }
  const hasTimes = openRaw != null && openRaw !== "" && closeRaw != null && closeRaw !== "";
  if (typeof raw.timings === "string" && /24\s*(hours|hrs|h)|24\/7|round the clock/i.test(raw.timings) && !hasTimes) {
    hours = { always: true };
  } else if (hasTimes) {
    const o = parseTimeDetail(openRaw);
    const c = parseTimeDetail(closeRaw);
    if (!o || !c) warnings.push("Opening or closing time not understood, hours left out");
    else {
      const open = o.t;
      let close = c.t;
      // "9 to 2" with no am/pm: a closing time before the opening time is read as the afternoon
      if (!o.hadMeridiem && !c.hadMeridiem && o.rawHour >= 6 && o.rawHour <= 11 && c.rawHour >= 1 && c.rawHour <= 8 && c.t < o.t) {
        close = hhmm(c.rawHour + 12, Number(c.t.slice(3)));
        warnings.push(`Closing time "${String(closeRaw)}" read as the afternoon (${close})`);
      }
      if (open === close) warnings.push("Opening and closing time are the same, hours left out");
      else {
        const days = parseDays(raw.days);
        if (!days || !days.length) warnings.push(raw.days == null || raw.days === "" ? "No days given, hours left out" : `Days "${String(raw.days)}" not understood, hours left out`);
        else {
          hours = buildHours(days, open, close);
          // Friday often closes earlier (Jumma): its own times replace the usual ones for Friday only
          const fo = raw.friopen != null && raw.friopen !== "" ? parseTimeDetail(raw.friopen) : null;
          const fc = raw.friclose != null && raw.friclose !== "" ? parseTimeDetail(raw.friclose) : null;
          if (fo || fc || raw.friopen != null || raw.friclose != null) {
            if (!fo || !fc) warnings.push("Friday needs both an opening and a closing time, so the usual times are used for Friday");
            else if (fo.t === fc.t) warnings.push("Friday opening and closing time are the same, the usual times are used for Friday");
            else if (!days.includes("fri")) warnings.push("Friday times were given but Friday is not in the days open, so they are ignored");
            else (hours.days as Record<string, TimeRange[]>).fri = [[fo.t, fc.t]];
          }
        }
      }
    }
  } else if (txt(raw.days)) {
    warnings.push("Days given but no times, hours left out");
  }

  // "Azizabad-6, Gulberg": the UC first (what a parent knows), then the town. Either alone is fine.
  let vaccine_type: string | null | undefined;
  if (opts.vtypeColumn) {
    vaccine_type = parseVaccineType(raw.vtype);
    if (vaccine_type === null && raw.vtype != null && String(raw.vtype).trim() !== "") warnings.push(`Vaccines offered "${String(raw.vtype)}" is not Government, Private or Both`);
  }
  const area = [txt(raw.uc), txt(raw.area)].filter(Boolean).join(", ") || txt(raw.district);
  const type = txt(raw.type);
  return {
    line,
    raw,
    needsResolve,
    warnings,
    payload: {
      name,
      district: txt(raw.district),
      area,
      address: txt(raw.address),
      phone: txt(raw.phone),
      notes: type,
      vaccines: txt(raw.vaccines),
      source_note: txt(raw.source),
      last_verified: dateText(raw.verified),
      lat,
      lng,
      hours,
      vaccine_type,
      service_fee: parseYes(raw.fee),
    },
  };
}

// ------------------------------------------------------------------ whole table
export interface ParsedSheet {
  rows: ParsedRow[];
  matched: VaccField[];
  unmatchedHeaders: string[];
  missingRequired: string[];   // plain-words problems with the sheet as a whole
  headerLine: number;
  vtypeDefaulted: boolean;   // no "vaccines offered" column: every row is treated as Government
}

// The first row (in the first 10) that has at least two recognisable headers is the header row.
export function parseTable(table: unknown[][]): ParsedSheet {
  let hi = -1;
  let map: (VaccField | null)[] = [];
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const m = (table[i] ?? []).map(fieldForHeader);
    if (m.filter(Boolean).length >= 2 && m.includes("name")) { hi = i; map = m; break; }
  }
  if (hi < 0) {
    return { rows: [], matched: [], unmatchedHeaders: [], missingRequired: ["No header row found. The first row must name a column for the centre name (for example centre_name)."], headerLine: 0, vtypeDefaulted: false };
  }
  const matched = Array.from(new Set(map.filter((x): x is VaccField => !!x)));
  const unmatchedHeaders = (table[hi] ?? []).map((h, i) => ({ h: txt(h), f: map[i] })).filter((x) => x.h && !x.f && !/^(row_?)?check/i.test(x.h)).map((x) => x.h as string); // a "check" helper column in our template is ignored on purpose
  const missing: string[] = [];
  if (!matched.includes("lat") && !matched.includes("maps")) missing.push("There is no location column. Add latitude and longitude, or a Google Maps link, for each centre.");
  if (!matched.includes("area") && !matched.includes("uc") && !matched.includes("district")) missing.push("There is no town, UC or district column.");
  const rows: ParsedRow[] = [];
  for (let r = hi + 1; r < table.length; r++) {
    const cells = table[r] ?? [];
    if (!cells.some((c) => c != null && String(c).trim() !== "")) continue;
    const raw: Record<string, unknown> = {};
    map.forEach((f, ci) => {
      if (!f) return;
      const v = cells[ci];
      if (v == null || (typeof v === "string" && v.trim() === "")) return;
      if (raw[f] == null) raw[f] = v; // the first column wins when two headers mean the same field
    });
    // skip instruction / example rows from our own template
    if (typeof raw.name === "string" && /^(example|instruction|note:)/i.test(raw.name.trim())) continue;
    rows.push(parseRow(raw, r + 1, { vtypeColumn: matched.includes("vtype") }));
  }
  return { rows, matched, unmatchedHeaders, missingRequired: missing, headerLine: hi + 1, vtypeDefaulted: !matched.includes("vtype") };
}

// What the admin screen sends to the database for one row.
export function toRpcRow(p: VaccPayload): Record<string, unknown> {
  return {
    name: p.name, district: p.district, area: p.area, address: p.address, phone: p.phone, notes: p.notes,
    vaccines: p.vaccines, source_note: p.source_note, last_verified: p.last_verified,
    lat: p.lat, lng: p.lng, hours: p.hours,
    ...(p.vaccine_type !== undefined ? { vaccine_type: p.vaccine_type } : {}),
    service_fee: p.service_fee === true,
  };
}

// Plain-words reasons the database gives back for a row.
export const REASON_TEXT: Record<string, string> = {
  name_missing_or_too_long: "Centre name is missing or too long",
  area_missing: "Area (town or UC) is missing",
  district_too_long: "District is too long",
  address_too_long: "Address is too long (240 characters at most)",
  phone_too_long: "Phone is too long",
  notes_too_long: "Centre type is too long",
  vaccines_too_long: "Vaccines text is too long (300 characters at most)",
  source_too_long: "Source note is too long (200 characters at most)",
  no_location: "No usable location (latitude and longitude, or a Google Maps link)",
  outside_service_area: "The pin is outside the areas the Locator covers",
  bad_hours: "Opening hours could not be saved",
  vaccine_type_missing_or_unknown: "Vaccines offered is empty or is not Government, Private or Both",
  unreadable_row: "Row could not be read",
  same_name_and_place_earlier_in_file: "Same centre appears earlier in this file",
};
