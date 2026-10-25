// Habit Age game (migration 0084). Shared questions, scoring and small
// helpers used by the game pages, the share cards and the API routes.
//
// IMPORTANT: this is a FUN estimate of daily habits. It is not a medical
// test and must never be presented as one. The questions are everyday
// habits only (no illness, weight, medicines or mood), and every question,
// tip and result line below should be reviewed by a physician before launch.

export interface HabitOption {
  label: string;
  points: 0 | 1 | 2 | 3;
}

export interface HabitQuestion {
  id: string;
  /** Short name used in lists ("Walking") */
  short: string;
  text: string;
  hint?: string;
  options: HabitOption[];
  /** Shown as "Today's best habit" when this is the player's strongest habit */
  praise: string;
  /** Shown as "One small idea" when this is the player's weakest habit */
  tip: string;
}

export const QUESTIONS: HabitQuestion[] = [
  {
    id: "bedtime",
    short: "Bedtime",
    text: "What time do you usually go to bed?",
    hint: "Pick the one closest to your usual night.",
    options: [
      { label: "Before 10 pm", points: 3 },
      { label: "Between 10 pm and 12 am", points: 2 },
      { label: "Between 12 am and 2 am", points: 1 },
      { label: "After 2 am", points: 0 },
    ],
    praise: "Going to bed on time. Great job!",
    tip: "Try going to bed 15 minutes earlier than usual this week.",
  },
  {
    id: "sleep",
    short: "Sleep",
    text: "How many hours do you usually sleep?",
    options: [
      { label: "7 to 9 hours", points: 3 },
      { label: "More than 9 hours", points: 2 },
      { label: "Around 6 hours", points: 2 },
      { label: "Around 5 hours", points: 1 },
      { label: "Less than 5 hours", points: 0 },
    ],
    praise: "Getting enough sleep. Great job!",
    tip: "Most adults feel best with around 7 to 9 hours of sleep. Protect your sleep time where you can.",
  },
  {
    id: "walking",
    short: "Walking",
    text: "How much do you walk or move around in a day?",
    options: [
      { label: "30 minutes or more, most days", points: 3 },
      { label: "15 to 29 minutes", points: 2 },
      { label: "Less than 15 minutes", points: 1 },
      { label: "Hardly any", points: 0 },
    ],
    praise: "Walking regularly. Great job!",
    tip: "A 10-minute walk after dinner is an easy way to start.",
  },
  {
    id: "water",
    short: "Water",
    text: "How much water do you drink in a day?",
    options: [
      { label: "6 glasses or more", points: 3 },
      { label: "4 to 5 glasses", points: 2 },
      { label: "2 to 3 glasses", points: 1 },
      { label: "Hardly any, mostly tea or soft drinks", points: 0 },
    ],
    praise: "Drinking water through the day. Great job!",
    tip: "Keep a bottle or glass of water within reach during the day.",
  },
  {
    id: "fried_sweet",
    short: "Fried and sweet food",
    text: "How often do you eat fried or very sugary food?",
    hint: "Samosas, pakoras, mithai, sweet drinks, extra sugar in chai.",
    options: [
      { label: "Rarely", points: 3 },
      { label: "A few times a week", points: 2 },
      { label: "Most days", points: 1 },
      { label: "Several times a day", points: 0 },
    ],
    praise: "Keeping fried and sugary food in check. Great job!",
    tip: "Try swapping one fried or sugary item a day, like less sugar in your chai.",
  },
  {
    id: "fruit_veg",
    short: "Fruit and vegetables",
    text: "How often do you eat fruit or vegetables?",
    options: [
      { label: "Every day, with most meals", points: 3 },
      { label: "Most days", points: 2 },
      { label: "A few times a week", points: 1 },
      { label: "Rarely", points: 0 },
    ],
    praise: "Eating fruit and vegetables. Great job!",
    tip: "Add one fruit or vegetable to a meal you already eat.",
  },
  {
    id: "screens",
    short: "Screens before bed",
    text: "When do you put your phone away at night?",
    options: [
      { label: "More than an hour before bed", points: 3 },
      { label: "About 30 minutes before bed", points: 2 },
      { label: "Just a few minutes before bed", points: 1 },
      { label: "I scroll until I fall asleep", points: 0 },
    ],
    praise: "Switching off screens before bed. Great job!",
    tip: "Keep your phone away for the last 30 minutes before bed.",
  },
  {
    id: "relax",
    short: "Relaxing",
    text: "How often do you make time to relax or wind down?",
    options: [
      { label: "Every day", points: 3 },
      { label: "Most days", points: 2 },
      { label: "Only sometimes", points: 1 },
      { label: "Almost never", points: 0 },
    ],
    praise: "Making time to relax. Great job!",
    tip: "Even 10 minutes of quiet time, a short walk or time with family counts.",
  },
];

export const QUESTION_COUNT = QUESTIONS.length;
export const MAX_POINTS = QUESTION_COUNT * 3;

export type Gender = "female" | "male" | "unsaid";
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unsaid", label: "Prefer not to say" },
];

export const MIN_AGE = 18;
export const MAX_AGE = 100;

/** Score 0 to 100 from the points of each answer (same maths as the database). */
export function scoreFromPoints(points: number[]): number {
  const sum = points.reduce((a, b) => a + b, 0);
  return Math.round((sum * 100) / MAX_POINTS);
}

/**
 * Habit Age is a playful reading of the answers against the player's real
 * age. Every answer is worth 0 to 3 points and each point is worth about one
 * year: all "okay" answers (2 points each, 16 in total) means "your habits
 * look your age"; every step better or worse than "okay" moves it about a
 * year younger or older. Capped (10 years younger at most, 12 older at most)
 * so nobody ever sees a dramatic number, and always presented as "for fun".
 *   all great (100) = 8 younger   mostly okay = same age
 *   half of them poor (score 50) = 4 older   mostly poor (score 33) = 8 older
 */
export function habitAgeFrom(realAge: number, score: number): number {
  const delta = Math.max(-10, Math.min(12, Math.round(16 - score * 0.24)));
  return Math.max(MIN_AGE - 3, realAge + delta);
}

export interface RoundResult {
  score: number;
  realAge: number;
  habitAge: number;
  /** A habit answered at the very best level (3 points). Null when none is. */
  best: { short: string; praise: string } | null;
  /** When no habit is at the best level: the closest one (2 points), so there is still something kind to say. */
  almost: { short: string } | null;
  idea: { short: string; tip: string };
}

/**
 * "Today's best habit" is only ever a habit answered at the best level (for
 * example 7 to 9 hours of sleep, or 30+ minutes of walking). An "okay" answer
 * is never praised as a good habit. With no best-level habit, the result
 * shows the closest one or a friendly fresh start instead.
 */
export function buildResult(points: number[], realAge: number): RoundResult {
  const score = scoreFromPoints(points);
  const lowest = Math.min(...points);
  const bestIndex = points.indexOf(3);
  const almostIndex = bestIndex >= 0 ? -1 : points.indexOf(2);
  const ideaIndex = points.indexOf(lowest);
  return {
    score,
    realAge,
    habitAge: habitAgeFrom(realAge, score),
    best: bestIndex >= 0 ? { short: QUESTIONS[bestIndex].short, praise: QUESTIONS[bestIndex].praise } : null,
    almost: almostIndex >= 0 ? { short: QUESTIONS[almostIndex].short } : null,
    idea: { short: QUESTIONS[ideaIndex].short, tip: QUESTIONS[ideaIndex].tip },
  };
}

// ------------------------------------------------------------------ cities
export interface HabitCity {
  id: number;
  name: string;
  province: string;
}

export const PROVINCE_CHIPS: { value: string; label: string }[] = [
  { value: "Punjab", label: "Punjab" },
  { value: "Sindh", label: "Sindh" },
  { value: "Khyber Pakhtunkhwa", label: "KP" },
  { value: "Balochistan", label: "Balochistan" },
  { value: "Islamabad", label: "Islamabad" },
  { value: "Gilgit-Baltistan", label: "GB" },
  { value: "Azad Kashmir", label: "AJK" },
];

export function provinceLabel(p: string): string {
  return PROVINCE_CHIPS.find((c) => c.value === p)?.label ?? p;
}

/** Cities that match what the player typed (start of a word first), optionally within one province. */
export function searchCities(cities: HabitCity[], query: string, province: string | null, limit = 8): HabitCity[] {
  const q = query.trim().toLowerCase();
  const pool = province ? cities.filter((c) => c.province === province) : cities;
  if (!q) return pool.slice(0, limit);
  const starts: HabitCity[] = [];
  const wordStarts: HabitCity[] = [];
  const contains: HabitCity[] = [];
  for (const c of pool) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) starts.push(c);
    else if (n.split(/[\s(]+/).some((w) => w.startsWith(q))) wordStarts.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  return [...starts, ...wordStarts, ...contains].slice(0, limit);
}

// ------------------------------------------------------- league / winners
export interface LeagueCity {
  city_id: number;
  name: string;
  province: string;
  avg: number;
  prev_avg?: number;
  delta?: number;
  entries?: number;
}
export interface LeagueData {
  game_live: boolean;
  league_live: boolean;
  show_counts: boolean;
  min_entries: number;
  /** Plays a city needs in the last 7 days to appear (migration 0087). */
  league_min?: number;
  cities: LeagueCity[];
}
export interface WinnerWeek {
  week_start: string;
  best?: { name: string; province: string; score: number; prev_score?: number };
  improved?: { name: string; province: string; delta: number; score?: number };
}
export interface LeaguePayload {
  league: LeagueData;
  winners: WinnerWeek[];
}

/** "19 Oct" style label for the Monday a winners week starts on. */
export function weekLabel(weekStart: string): string {
  const s = new Date(weekStart + "T00:00:00Z");
  const e = new Date(s.getTime() + 6 * 86400000);
  const f = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(s)} to ${f(e)}`;
}

// ------------------------------------------------- on-the-phone memory
// Everything here stays on the player's phone. Browser storage can be
// blocked or full, so every call is wrapped and the game works without it.
export interface HabitProfile {
  gender: Gender;
  age: number;
  cityId: number | null;
  cityName: string | null;
  province: string | null;
}
export interface HabitLast {
  day: string; // Pakistan date of the last counted round
  score: number;
  habitAge: number;
}

const PROFILE_KEY = "fm_habit_profile_v1";
const LAST_KEY = "fm_habit_last_v1";
const PLAYED_KEY = "fm_habit_played_v1";

export function pakistanToday(): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function loadProfile(): HabitProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<HabitProfile>;
    if (!p || !["female", "male", "unsaid"].includes(String(p.gender))) return null;
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return null;
    return {
      gender: p.gender as Gender,
      age,
      cityId: typeof p.cityId === "number" ? p.cityId : null,
      cityName: typeof p.cityName === "string" ? p.cityName : null,
      province: typeof p.province === "string" ? p.province : null,
    };
  } catch {
    return null;
  }
}
export function saveProfile(p: HabitProfile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage blocked: the player simply sets up again next time
  }
}
export function loadLast(): HabitLast | null {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const l = JSON.parse(raw) as Partial<HabitLast>;
    if (!l || typeof l.day !== "string" || typeof l.score !== "number" || typeof l.habitAge !== "number") return null;
    return l as HabitLast;
  } catch {
    return null;
  }
}
export function saveLast(l: HabitLast) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(l));
  } catch {
    // ignore
  }
}
export function hasPlayedBefore(): boolean {
  try {
    return window.localStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}
export function markPlayed() {
  try {
    window.localStorage.setItem(PLAYED_KEY, "1");
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------ network
/** Fire-and-forget counter ("visit", "start", "share", "doctor_tap"). Never throws. */
export function trackHabitEvent(event: "visit" | "start" | "share" | "doctor_tap" | "channel_tap") {
  try {
    void fetch("/api/habit/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // never let a counter break the game
  }
}

export async function fetchLeague(): Promise<LeaguePayload | null> {
  try {
    const res = await fetch("/api/habit/league");
    if (!res.ok) return null;
    return (await res.json()) as LeaguePayload;
  } catch {
    return null;
  }
}

export async function fetchCities(): Promise<HabitCity[]> {
  try {
    const res = await fetch("/api/habit/cities");
    if (!res.ok) return [];
    const data = (await res.json()) as { cities?: HabitCity[] };
    return Array.isArray(data.cities) ? data.cities : [];
  } catch {
    return [];
  }
}
