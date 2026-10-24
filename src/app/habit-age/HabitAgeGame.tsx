"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  GENDER_OPTIONS,
  MAX_AGE,
  MIN_AGE,
  PROVINCE_CHIPS,
  QUESTIONS,
  QUESTION_COUNT,
  buildResult,
  fetchCities,
  fetchLeague,
  habitAgeFrom,
  hasPlayedBefore,
  loadLast,
  loadProfile,
  markPlayed,
  pakistanToday,
  provinceLabel,
  saveLast,
  saveProfile,
  scoreFromPoints,
  searchCities,
  trackHabitEvent,
  type Gender,
  type HabitCity,
  type HabitLast,
  type HabitProfile,
  type LeagueData,
  type RoundResult,
} from "@/lib/habitAge";
import { drawPersonalCard, shareOrDownloadCard } from "@/lib/habitCards";

// Habit Age (migration 0084). Steps: intro -> about you -> city -> 8 quick
// questions -> result. Everything the player types stays on their phone; only
// anonymous totals (city, gender, the eight answers) are sent when a round
// finishes, and the result is always shown even if counting fails.
//
// Look and feel: one bold teal "game board" with bright white answer tiles and
// amber highlights, so a tapped answer is unmistakable (the tile turns amber
// with a tick), the Habit Age moves live as you answer, and the result counts
// up. Motion is switched off for people who ask their phone for less motion.

type Step = "intro" | "about" | "city" | "quiz" | "result";

const BOARD =
  "relative overflow-hidden rounded-[28px] bg-[radial-gradient(520px_260px_at_100%_-5%,rgba(255,180,84,0.28),transparent_60%),radial-gradient(420px_240px_at_-10%_105%,rgba(45,212,191,0.35),transparent_60%),linear-gradient(165deg,#0f8f83,#0a4a44_55%,#072927)] p-5 text-white shadow-[0_28px_60px_-28px_rgba(7,41,39,0.85)] sm:p-8";
const PRIMARY =
  "inline-flex w-full items-center justify-center rounded-full bg-[#ffb454] px-6 py-4 text-lg font-extrabold text-[#3b2500] shadow-[0_12px_26px_-12px_rgba(255,180,84,0.95)] transition hover:bg-[#ffc272] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/55 disabled:shadow-none";
const SECONDARY =
  "inline-flex w-full items-center justify-center rounded-full border-2 border-white/45 px-6 py-3.5 text-base font-bold text-white transition hover:border-white active:scale-[0.98]";
const INPUT =
  "w-full rounded-2xl border-2 border-transparent bg-white px-5 py-3.5 text-lg font-bold text-ink-900 outline-none placeholder:font-semibold placeholder:text-ink-400 focus:border-[#ffb454]";
const ERROR_BOX = "rounded-xl bg-[#fff1f0] px-4 py-3 text-sm font-bold text-red-700";
const LABEL = "text-xs font-extrabold tracking-[0.18em] text-[#ffd08a]";

const ANIMATION_CSS = `
@keyframes habitPop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.12) } 100% { transform: scale(1); opacity: 1 } }
@keyframes habitRise { 0% { transform: translateY(14px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes habitGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(255,180,84,.55) } 50% { box-shadow: 0 0 0 10px rgba(255,180,84,0) } }
.habit-pop { animation: habitPop .32s ease-out both }
.habit-rise { animation: habitRise .45s ease-out both }
.habit-glow { animation: habitGlow 1.6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .habit-pop, .habit-rise, .habit-glow { animation: none !important } }
`;

const QUESTION_ICONS: Record<string, string> = {
  bedtime: "🌙",
  sleep: "😴",
  walking: "🚶",
  water: "💧",
  fried_sweet: "🍟",
  fruit_veg: "🥗",
  screens: "📱",
  relax: "🧘",
};

function buzz() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
  } catch {
    // no vibration on this phone: fine
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-sm">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z"
            fill="none"
            stroke="#0f766e"
            strokeWidth="2.2"
            strokeLinejoin="round"
            transform="translate(2.6 2.6) scale(.78)"
          />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[17px] font-extrabold text-white">Family Medic</span>
        <span className="block text-[10px] font-bold tracking-[0.22em] text-[#ffd08a]">HABIT AGE</span>
      </span>
    </div>
  );
}

// Every screen has a clear way back, at the top where thumbs and eyes look first.
function TopBar({ onBack, backLabel, right }: { onBack?: () => void; backLabel: string; right?: React.ReactNode }) {
  const cls =
    "inline-flex items-center gap-1.5 rounded-full border-2 border-white/35 bg-white/10 px-3.5 py-2 text-sm font-bold text-white transition hover:border-white active:scale-[0.97]";
  const arrow = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      {onBack ? (
        <button type="button" onClick={onBack} className={cls} data-testid="habit-back">
          {arrow}
          {backLabel}
        </button>
      ) : (
        <Link href="/calculators" className={cls} data-testid="habit-back">
          {arrow}
          {backLabel}
        </Link>
      )}
      {right}
    </div>
  );
}

function ProgressBar({ index, total }: { index: number; total: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2.5 flex-1 rounded-full transition-colors duration-300 ${i < index ? "bg-[#ffb454]" : i === index ? "bg-white" : "bg-white/25"}`}
        />
      ))}
    </div>
  );
}

function Ring({ score, children }: { score: number; children: React.ReactNode }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const target = Math.max(0.04, Math.min(1, score / 100));
  const [f, setF] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setF(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return (
    <div className="relative mx-auto h-[220px] w-[220px] sm:h-[240px] sm:w-[240px]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="14" />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="#ffb454"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`}
          style={{ transition: reducedMotion() ? "none" : "stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// Counts from the player's real age to their Habit Age so the result "lands".
function CountUp({ from, to }: { from: number; to: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (reducedMotion() || from === to) {
      const id = requestAnimationFrame(() => setV(to));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return (
    <span className="text-7xl font-extrabold leading-none text-white sm:text-[80px]" data-testid="habit-age-value" aria-label={`Habit Age ${to}`}>
      {v}
    </span>
  );
}

function titleFor(score: number): { label: string; line: string } {
  if (score >= 80) return { label: "Habit Hero", line: "Your everyday habits are doing great." };
  if (score >= 60) return { label: "On the right track", line: "Good habits, with a few easy wins left." };
  if (score >= 40) return { label: "Warming up", line: "A few small changes can move this quickly." };
  return { label: "Fresh start ahead", line: "Every small step counts. Start with just one." };
}

const REACTIONS: Record<number, string> = {
  3: "Great habit!",
  2: "Not bad at all!",
  1: "Room to improve",
  0: "Thanks for being honest",
};

export default function HabitAgeGame() {
  const [step, setStep] = useState<Step>("intro");
  const [profile, setProfile] = useState<HabitProfile | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageText, setAgeText] = useState("");
  const [cityId, setCityId] = useState<number | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [cityProvince, setCityProvince] = useState<string | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const [changingCity, setChangingCity] = useState(true);
  const [provinceFilter, setProvinceFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<HabitCity[]>([]);
  const [citiesState, setCitiesState] = useState<"loading" | "ready" | "failed">("loading");
  const [league, setLeague] = useState<LeagueData | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(QUESTION_COUNT).fill(null));
  const [result, setResult] = useState<RoundResult | null>(null);
  const [prevLast, setPrevLast] = useState<HabitLast | null>(null);
  const [countedNote, setCountedNote] = useState<"counted" | "already" | "not_counted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot: real people never see or fill this
  const startedAt = useRef<number>(0);
  const roundActive = useRef(false); // a quiz is in progress (so going back and forward keeps the answers)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // First visit: restore the saved details, count the visit (once per session), load the lists.
  useEffect(() => {
    // Saved details live in the phone's storage, which can only be read in the browser after the first render.
    void Promise.resolve().then(() => {
      const p = loadProfile();
      if (p) setProfile(p);
    });
    try {
      if (!window.sessionStorage.getItem("fm_habit_visit")) {
        window.sessionStorage.setItem("fm_habit_visit", "1");
        trackHabitEvent("visit");
      }
    } catch {
      trackHabitEvent("visit");
    }
    let cancelled = false;
    void fetchCities().then((list) => {
      if (cancelled) return;
      setCities(list);
      setCitiesState(list.length > 0 ? "ready" : "failed");
    });
    void fetchLeague().then((payload) => {
      if (cancelled) return;
      setLeague(payload?.league ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gameOff = league !== null && league.game_live === false;

  const matches = useMemo(() => searchCities(cities, query, provinceFilter, 8), [cities, query, provinceFilter]);

  const cityAvg = useMemo(() => {
    if (!league || !league.league_live || !cityId) return null;
    const row = league.cities.find((c) => c.city_id === cityId);
    return row ? row.avg : null;
  }, [league, cityId]);

  // Habit Age "so far": unanswered questions count as "okay" (2 points) until you answer them.
  const liveAge = useMemo(() => {
    const age = profile?.age ?? (Number(ageText) || 0);
    if (!age) return null;
    const pts = QUESTIONS.map((q, i) => (answers[i] === null ? 2 : q.options[answers[i] as number].points));
    return habitAgeFrom(age, scoreFromPoints(pts));
  }, [answers, profile, ageText]);

  const startQuiz = useCallback((age: number, g: Gender, id: number | null, name: string | null, prov: string | null) => {
    saveProfile({ gender: g, age, cityId: id, cityName: name, province: prov });
    setProfile({ gender: g, age, cityId: id, cityName: name, province: prov });
    setAnswers(Array(QUESTION_COUNT).fill(null));
    setQIndex(0);
    setResult(null);
    setCountedNote(null);
    setShareOpen(false);
    setShareMsg(null);
    setError(null);
    startedAt.current = Date.now();
    roundActive.current = true;
    setStep("quiz");
    trackHabitEvent("start");
  }, []);

  function playAsSaved() {
    if (!profile) return;
    setGender(profile.gender);
    setAgeText(String(profile.age));
    setCityId(profile.cityId);
    setCityName(profile.cityName);
    setCityProvince(profile.province);
    setCityTouched(true);
    startQuiz(profile.age, profile.gender, profile.cityId, profile.cityName, profile.province);
  }

  function beginSetup() {
    setError(null);
    if (profile) {
      setGender(profile.gender);
      setAgeText(String(profile.age));
      setCityId(profile.cityId);
      setCityName(profile.cityName);
      setCityProvince(profile.province);
      setCityTouched(true);
      setChangingCity(false);
    } else {
      setChangingCity(true);
    }
    roundActive.current = false;
    setStep("about");
  }

  function submitAbout() {
    const age = Number(ageText);
    if (!gender) {
      setError("Please choose one option.");
      return;
    }
    if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) {
      setError(`Habit Age is for adults. Please enter an age from ${MIN_AGE} to ${MAX_AGE}.`);
      return;
    }
    setError(null);
    setStep("city");
  }

  function pickCity(c: HabitCity) {
    buzz();
    setCityId(c.id);
    setCityName(c.name);
    setCityProvince(c.province);
    setCityTouched(true);
    setQuery("");
    setChangingCity(false);
  }
  function pickOther() {
    buzz();
    setCityId(null);
    setCityName(null);
    setCityProvince(null);
    setCityTouched(true);
    setQuery("");
    setChangingCity(false);
  }

  function submitCity() {
    if (!gender) return;
    if (roundActive.current) {
      // came back from the questions to fix something: keep the answers, just update the details
      saveProfile({ gender, age: Number(ageText), cityId, cityName, province: cityProvince });
      setProfile({ gender, age: Number(ageText), cityId, cityName, province: cityProvince });
      setStep("quiz");
      return;
    }
    startQuiz(Number(ageText), gender, cityId, cityName, cityProvince);
  }

  // answers[] holds the POSITION of the picked option (some options share points)
  function choose(optionIndex: number) {
    buzz();
    setAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optionIndex;
      return next;
    });
  }

  async function finishQuiz(final: number[]) {
    const age = profile?.age ?? Number(ageText);
    const g = profile?.gender ?? gender ?? "unsaid";
    const res = buildResult(final, age);
    const before = loadLast();
    setPrevLast(before);
    setResult(res);
    roundActive.current = false;
    setStep("result");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });

    // One counted round per device per day. Playing again is still fine, it just is not counted twice.
    const today = pakistanToday();
    const wasPlayer = hasPlayedBefore();
    if (before && before.day === today) {
      setCountedNote("already");
    } else {
      try {
        const r = await fetch("/api/habit/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender: g,
            answers: final,
            cityId: profile?.cityId ?? 0,
            returning: wasPlayer,
            elapsedMs: Date.now() - startedAt.current,
            website,
          }),
        });
        const data = (await r.json().catch(() => null)) as { ok?: boolean; counted?: boolean } | null;
        if (r.ok && data?.counted) {
          setCountedNote("counted");
          saveLast({ day: today, score: res.score, habitAge: res.habitAge });
          // refresh the league numbers so the average moves a little
          void fetchLeague().then((p) => p && setLeague(p.league));
        } else {
          setCountedNote("not_counted");
        }
      } catch {
        setCountedNote("not_counted");
      }
    }
    markPlayed();
  }

  function nextQuestion() {
    if (answers[qIndex] === null) return;
    if (qIndex < QUESTION_COUNT - 1) {
      setQIndex(qIndex + 1);
      return;
    }
    void finishQuiz(answers.map((a, i) => QUESTIONS[i].options[a ?? 0].points));
  }

  async function openShare() {
    if (!result) return;
    setShareOpen(true);
    setShareMsg(null);
    // wait for the canvas to exist, then draw
    setTimeout(() => {
      if (canvasRef.current) {
        void drawPersonalCard(canvasRef.current, {
          habitAge: result.habitAge,
          realAge: result.realAge,
          score: result.score,
          cityLabel: profile?.cityName ? `${profile.cityName}, ${profile.province ?? ""}`.replace(/, $/, "") : null,
          cityName: profile?.cityName ?? null,
          cityAvg,
        });
      }
    }, 0);
  }

  async function doShare() {
    if (!canvasRef.current || !result) return;
    setSharing(true);
    const outcome = await shareOrDownloadCard(
      canvasRef.current,
      "my-habit-age.png",
      `My Habit Age is ${result.habitAge}. How old are your habits? Just for fun.`
    );
    setSharing(false);
    if (outcome === "shared" || outcome === "downloaded") trackHabitEvent("share");
    setShareMsg(
      outcome === "shared"
        ? "Shared. Thank you!"
        : outcome === "downloaded"
          ? "Saved to your phone. Share it with your friends!"
          : outcome === "cancelled"
            ? null
            : "Sorry, we could not make the picture. Please try again."
    );
  }

  const cityLine = profile?.cityName ? `${profile.cityName}${profile.province ? `, ${profile.province}` : ""}` : null;

  // ---------------------------------------------------------------- screens
  if (step === "intro") {
    return (
      <div className={BOARD}>
        <style>{ANIMATION_CSS}</style>
        <TopBar backLabel="All free tools" />
        <Brand />
        <h2 className="habit-rise mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
          How old are your <span className="text-[#ffb454]">habits</span>?
        </h2>
        <p className="habit-rise mt-3 text-base leading-relaxed text-teal-50/90" style={{ animationDelay: "80ms" }}>
          Answer 8 quick questions about everyday habits, get your Habit Age, then see how your city is doing. Takes
          about a minute.
        </p>
        <ul className="habit-rise mt-5 flex flex-wrap gap-2" style={{ animationDelay: "160ms" }}>
          {["Free, no sign-up", "No names or phone numbers", "Just for fun"].map((t) => (
            <li key={t} className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold text-white sm:text-sm">
              {t}
            </li>
          ))}
        </ul>
        {gameOff ? (
          <p className="mt-6 rounded-2xl bg-[#fff6e8] p-4 text-sm font-bold text-[#7a4a00]">
            Habit Age is taking a short break. Please come back soon.
          </p>
        ) : (
          <div className="mt-7 grid gap-3">
            {profile ? (
              <>
                <button type="button" className={`${PRIMARY} habit-glow`} onClick={playAsSaved} data-testid="habit-play-saved">
                  Play again{cityLine ? ` as ${cityLine}` : ""}
                </button>
                <button type="button" className={SECONDARY} onClick={beginSetup} data-testid="habit-change-details">
                  Change my details
                </button>
              </>
            ) : (
              <button type="button" className={`${PRIMARY} habit-glow`} onClick={beginSetup} data-testid="habit-start">
                Start the quiz
              </button>
            )}
          </div>
        )}
        <Link href="/habit-age/league" className="mt-5 block text-center text-sm font-bold text-[#ffd08a] underline underline-offset-4">
          See the city league
        </Link>
        <p className="mt-5 text-center text-xs leading-relaxed text-teal-100/75">
          A fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    );
  }

  if (step === "about") {
    return (
      <div className={BOARD}>
        <style>{ANIMATION_CSS}</style>
        <TopBar onBack={() => setStep("intro")} backLabel="Back" right={<span className="text-sm font-extrabold text-[#ffd08a]">Step 1 of 2</span>} />
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">A little about you</h2>
        <p className="mt-2 text-sm text-teal-50/85">Used only for the city and gender totals. It is never tied to your name.</p>

        <p className={`mt-6 ${LABEL}`}>I AM</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gender">
          {GENDER_OPTIONS.map((g) => {
            const on = gender === g.value;
            return (
              <button
                key={g.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  buzz();
                  setGender(g.value);
                }}
                className={`rounded-full border-2 px-2 py-3.5 text-sm font-extrabold transition active:scale-[0.97] ${
                  on ? "border-[#ffb454] bg-[#ffb454] text-[#3b2500]" : "border-white/30 bg-white/10 text-white hover:border-white"
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <label htmlFor="habit-age-input" className={`mt-6 block ${LABEL}`}>
          MY AGE
        </label>
        <input
          id="habit-age-input"
          type="number"
          inputMode="numeric"
          min={MIN_AGE}
          max={MAX_AGE}
          value={ageText}
          onChange={(e) => setAgeText(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          placeholder="e.g. 34"
          className={`mt-2 ${INPUT}`}
        />
        <p className="mt-2 text-xs text-teal-100/75">Habit Age is for adults, {MIN_AGE} and over.</p>

        {error && (
          <p role="alert" className={`mt-4 ${ERROR_BOX}`}>
            {error}
          </p>
        )}
        <div className="mt-7 grid gap-3">
          <button type="button" className={PRIMARY} onClick={submitAbout} data-testid="habit-about-next">
            Next
          </button>
        </div>
      </div>
    );
  }

  if (step === "city") {
    return (
      <div className={BOARD}>
        <style>{ANIMATION_CSS}</style>
        <TopBar onBack={() => setStep("about")} backLabel="Back" right={<span className="text-sm font-extrabold text-[#ffd08a]">Step 2 of 2</span>} />
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Which city are you in?</h2>
        <p className="mt-2 text-sm text-teal-50/85">Your answers count towards your city in the league.</p>

        {cityTouched && !changingCity ? (
          <div className="habit-pop mt-5 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-4 text-ink-900" data-testid="habit-city-chosen">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-[#ffb454] text-lg" aria-hidden="true">
                📍
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">YOUR CITY</p>
                <p className="truncate text-lg font-extrabold">{cityName ? `${cityName}, ${cityProvince}` : "No city (other)"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setChangingCity(true)}
              className="flex-none rounded-full border-2 border-teal-700/30 px-4 py-2 text-sm font-extrabold text-teal-800 hover:border-teal-700"
              data-testid="habit-city-change"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="-mx-1 mt-5 flex flex-wrap gap-2">
              {PROVINCE_CHIPS.map((p) => {
                const on = provinceFilter === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setProvinceFilter(on ? null : p.value)}
                    className={`rounded-full border-2 px-4 py-2 text-sm font-extrabold transition active:scale-[0.97] ${
                      on ? "border-[#ffb454] bg-[#ffb454] text-[#3b2500]" : "border-white/30 bg-white/10 text-white hover:border-white"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <label htmlFor="habit-city-search" className="sr-only">
              Search for your city
            </label>
            <input
              id="habit-city-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={citiesState === "loading" ? "Loading cities…" : "Type your city, e.g. Gujrat"}
              className={`mt-4 ${INPUT}`}
            />

            {citiesState === "failed" && (
              <p className="mt-3 rounded-xl bg-[#fff6e8] px-4 py-3 text-sm font-bold text-[#7a4a00]">
                We could not load the city list right now. You can still play: choose &quot;Other&quot; below.
              </p>
            )}

            <ul className="mt-3 grid gap-2" data-testid="habit-city-results">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickCity(c)}
                    className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.98] ${
                      cityId === c.id ? "border-[#ffb454] bg-[#ffb454] text-[#3b2500]" : "border-transparent bg-white text-ink-900 hover:border-[#ffb454]"
                    }`}
                  >
                    <span className="text-base font-extrabold">{c.name}</span>
                    <span className="text-xs font-extrabold text-teal-700">{provinceLabel(c.province)}</span>
                  </button>
                </li>
              ))}
              {query.trim() && matches.length === 0 && citiesState === "ready" && (
                <li className="rounded-2xl bg-white/15 px-4 py-3 text-sm font-semibold text-white">
                  No city found. Try another spelling, or choose &quot;Other&quot;.
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={pickOther}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-dashed border-white/50 bg-white/10 px-4 py-3 text-left text-white transition hover:border-white active:scale-[0.98]"
                >
                  <span className="text-base font-extrabold">Other / my city is not listed</span>
                  <span className="text-xs font-semibold text-teal-100/80">not counted in a city</span>
                </button>
              </li>
            </ul>
          </>
        )}

        <div className="mt-6 grid gap-3">
          <button type="button" className={PRIMARY} onClick={submitCity} disabled={!cityTouched || changingCity} data-testid="habit-city-next">
            Start the 8 questions
          </button>
        </div>
      </div>
    );
  }

  if (step === "quiz") {
    const q = QUESTIONS[qIndex];
    const chosen = answers[qIndex];
    const chosenPoints = chosen === null ? null : q.options[chosen].points;
    const realAge = profile?.age ?? (Number(ageText) || 0);
    const liveDiff = liveAge !== null && realAge ? liveAge - realAge : 0;
    return (
      <div className={BOARD}>
        <style>{ANIMATION_CSS}</style>
        <TopBar
          onBack={() => {
            if (qIndex > 0) setQIndex(qIndex - 1);
            else {
              setChangingCity(false);
              setStep("city");
            }
          }}
          backLabel="Back"
          right={
            <span className="rounded-full bg-white/15 px-3.5 py-2 text-sm font-extrabold">
              {qIndex + 1} <span className="text-white/60">/ {QUESTION_COUNT}</span>
            </span>
          }
        />
        <ProgressBar index={qIndex} total={QUESTION_COUNT} />

        {/* Live Habit Age: moves as you answer, so every tap feels like it counts */}
        {liveAge !== null && (
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/12 px-4 py-2.5" data-testid="habit-live">
            <span className="text-xs font-extrabold tracking-[0.14em] text-[#ffd08a]">HABIT AGE SO FAR</span>
            <span key={liveAge} className="habit-pop flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-white">{liveAge}</span>
              <span className={`text-xs font-extrabold ${liveDiff < 0 ? "text-[#7ef0c9]" : liveDiff > 0 ? "text-[#ffb454]" : "text-white/70"}`}>
                {liveDiff === 0 ? "your age" : liveDiff < 0 ? `${Math.abs(liveDiff)} ${Math.abs(liveDiff) === 1 ? "year" : "years"} younger` : `${liveDiff} ${liveDiff === 1 ? "year" : "years"} older`}
              </span>
            </span>
          </div>
        )}

        <div key={q.id} className="habit-rise mt-5">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-3xl" aria-hidden="true">
            {QUESTION_ICONS[q.id] ?? "✨"}
          </span>
          <h2 className="mt-3 text-2xl font-extrabold leading-snug tracking-tight sm:text-[28px]" data-testid="habit-question">
            {q.text}
          </h2>
          {q.hint && <p className="mt-1.5 text-sm text-teal-50/85">{q.hint}</p>}
        </div>

        <div className="mt-5 grid gap-2.5" role="radiogroup" aria-label={q.text}>
          {q.options.map((o, oi) => {
            const on = chosen === oi;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => choose(oi)}
                className={`flex items-center gap-3.5 rounded-2xl border-2 px-4 py-4 text-left text-base font-extrabold transition active:scale-[0.98] ${
                  on
                    ? "scale-[1.015] border-white bg-[#ffb454] text-[#3b2500] shadow-[0_14px_28px_-14px_rgba(255,180,84,0.95)]"
                    : "border-transparent bg-white text-ink-900 hover:border-[#ffb454]"
                }`}
              >
                <span
                  className={`grid h-8 w-8 flex-none place-items-center rounded-full text-sm font-extrabold ${
                    on ? "habit-pop bg-[#3b2500] text-white" : "bg-[#d9efec] text-teal-800"
                  }`}
                  aria-hidden="true"
                >
                  {on ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    String.fromCharCode(65 + oi)
                  )}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 min-h-[28px]" aria-live="polite">
          {chosenPoints !== null && (
            <p key={`${qIndex}-${chosen}`} className="habit-pop inline-block rounded-full bg-white/15 px-4 py-1.5 text-sm font-extrabold text-white" data-testid="habit-reaction">
              {REACTIONS[chosenPoints]}
            </p>
          )}
        </div>

        <div className="mt-3 grid gap-3">
          <button type="button" className={`${PRIMARY} ${chosen !== null ? "habit-glow" : ""}`} onClick={nextQuestion} disabled={chosen === null} data-testid="habit-next">
            {qIndex === QUESTION_COUNT - 1 ? "See my Habit Age" : "Next"}
          </button>
        </div>
        {/* Honeypot: hidden from people, tempting to bots. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
          </label>
        </div>
      </div>
    );
  }

  // result
  const r = result;
  if (!r) return null;
  const cityDiff = cityAvg !== null ? r.score - cityAvg : null;
  const title = titleFor(r.score);
  const gap = r.habitAge - r.realAge;
  const improvement = prevLast ? r.score - prevLast.score : null;
  return (
    <div className={BOARD}>
      <style>{ANIMATION_CSS}</style>
      <TopBar
        onBack={() => {
          setStep("intro");
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
        }}
        backLabel="Back"
      />
      <div className="flex justify-center">
        <span className="habit-pop rounded-full bg-[#ffb454] px-4 py-1.5 text-xs font-extrabold tracking-[0.14em] text-[#3b2500]" data-testid="habit-title">
          {title.label.toUpperCase()}
        </span>
      </div>
      <h2 className="mt-3 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
        Today your habits look <span className="text-[#ffb454]">{r.habitAge}</span>
      </h2>
      <p className="mt-1 text-center text-sm font-semibold text-teal-50/90">{title.line}</p>
      <div className="mt-4">
        <Ring score={r.score}>
          <CountUp from={r.realAge} to={r.habitAge} />
          <span className="mt-2 text-xs font-bold tracking-[0.22em] text-teal-100/85">HABIT AGE</span>
          {gap !== 0 && (
            <span className={`mt-1 text-xs font-extrabold ${gap < 0 ? "text-[#7ef0c9]" : "text-[#ffb454]"}`}>
              {gap < 0 ? `${Math.abs(gap)} years younger` : `${gap} years older`}
            </span>
          )}
        </Ring>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2.5 text-center">
        {[
          { v: r.realAge, l: "Real age" },
          { v: r.habitAge, l: "Habit Age" },
          { v: r.score, l: "Habit Score" },
        ].map((t, i) => (
          <div key={t.l} className="habit-rise rounded-2xl bg-white/15 px-2 py-4" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="text-3xl font-extrabold">{t.v}</div>
            <div className="mt-0.5 text-xs font-bold text-teal-50/90 sm:text-sm">{t.l}</div>
          </div>
        ))}
      </div>

      {prevLast && improvement !== null && (
        <div className="habit-rise mt-3 rounded-2xl bg-white/15 p-4" style={{ animationDelay: "250ms" }} data-testid="habit-vs-last">
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-[#ffd08a]">YOU VS LAST TIME</p>
          <p className="mt-1 text-base font-extrabold">
            {improvement > 0
              ? `Up ${improvement} points from your last score of ${prevLast.score}. Keep it going!`
              : improvement === 0
                ? `Same as your last score of ${prevLast.score}. Can you beat it next time?`
                : `Your last score was ${prevLast.score}. Try to beat it next time!`}
          </p>
        </div>
      )}

      {cityLine && (
        <div className="habit-rise mt-3 rounded-2xl bg-[#ffb454] p-4 text-[#3b2500]" style={{ animationDelay: "320ms" }}>
          <p className="text-[11px] font-extrabold tracking-[0.16em]">YOUR CITY · {cityLine.toUpperCase()}</p>
          {cityAvg !== null ? (
            <>
              <p className="mt-1 text-xl font-extrabold">City average score: {cityAvg}</p>
              <p className="text-sm font-bold">
                {cityDiff !== null && cityDiff > 0
                  ? "You're above your city's average. Nice!"
                  : cityDiff !== null && cityDiff === 0
                    ? "You're right on your city's average."
                    : "Your city is ahead for now. One small habit can close the gap."}
              </p>
            </>
          ) : (
            <p className="mt-1 text-base font-extrabold">Your answers now count towards {profile?.cityName}.</p>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3">
        {/* "Best habit" is praised only when it was answered at the very top level.
            Otherwise: the closest one, or a friendly fresh start. Nobody is told a poor habit is good. */}
        {r.best ? (
          <div className="habit-rise rounded-2xl bg-white p-4 text-ink-900" style={{ animationDelay: "400ms" }} data-testid="habit-best">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">TODAY&apos;S BEST HABIT</p>
            <p className="mt-1 text-base font-bold sm:text-lg">{r.best.praise}</p>
          </div>
        ) : r.almost ? (
          <div className="habit-rise rounded-2xl bg-white p-4 text-ink-900" style={{ animationDelay: "400ms" }} data-testid="habit-best">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">CLOSEST TO A GOOD HABIT</p>
            <p className="mt-1 text-base font-bold sm:text-lg">
              {r.almost.short} is not far off. A small push and it becomes a strength.
            </p>
          </div>
        ) : (
          <div className="habit-rise rounded-2xl bg-white p-4 text-ink-900" style={{ animationDelay: "400ms" }} data-testid="habit-best">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">A FRESH START</p>
            <p className="mt-1 text-base font-bold sm:text-lg">
              Nobody starts perfect, and every habit here can improve. Pick just one small change this week and play
              again to see your Habit Age move.
            </p>
          </div>
        )}
        <div className="habit-rise rounded-2xl bg-white p-4 text-ink-900" style={{ animationDelay: "480ms" }}>
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">ONE SMALL IDEA</p>
          <p className="mt-1 text-base font-bold sm:text-lg">{r.idea.tip}</p>
        </div>
      </div>

      {countedNote === "already" && (
        <p className="mt-3 text-center text-xs font-semibold text-teal-100/85">
          Your round for today is already in the league. Play again as often as you like for fun.
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={openShare} className={PRIMARY} data-testid="habit-share">
          Share my card
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("intro");
            if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          }}
          className={SECONDARY}
          data-testid="habit-again"
        >
          Play again
        </button>
      </div>

      {shareOpen && (
        <div className="mt-4 rounded-2xl bg-white/12 p-3" data-testid="habit-share-panel">
          <canvas ref={canvasRef} className="mx-auto w-full max-w-[320px] rounded-xl" aria-label="Your Habit Age share card" />
          <button
            type="button"
            onClick={doShare}
            disabled={sharing}
            className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 text-base font-extrabold text-[#0a3733] disabled:opacity-60"
          >
            {sharing ? "Getting your card ready…" : "Share or save picture"}
          </button>
          {shareMsg && <p className="mt-2 text-center text-sm font-semibold text-teal-50">{shareMsg}</p>}
        </div>
      )}

      <div className="mt-5 flex flex-col items-center gap-2 text-center">
        <Link
          href="/book"
          onClick={() => trackHabitEvent("doctor_tap")}
          className="text-sm font-bold text-white underline underline-offset-4"
          data-testid="habit-ask-doctor"
        >
          Questions? Ask a family doctor
        </Link>
        <Link href="/habit-age/league" className="text-sm font-bold text-[#ffb454] underline underline-offset-4">
          See the city league
        </Link>
        <p className="mt-2 text-xs leading-relaxed text-teal-100/75">
          This is a fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    </div>
  );
}
