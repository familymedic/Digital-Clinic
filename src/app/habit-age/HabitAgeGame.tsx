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
  hasPlayedBefore,
  loadLast,
  loadProfile,
  markPlayed,
  pakistanToday,
  provinceLabel,
  saveLast,
  saveProfile,
  searchCities,
  trackHabitEvent,
  type Gender,
  type HabitCity,
  type HabitProfile,
  type LeagueData,
  type RoundResult,
} from "@/lib/habitAge";
import { drawPersonalCard, shareOrDownloadCard } from "@/lib/habitCards";

// Habit Age (migration 0084). Steps: intro -> about you -> city -> 8 quick
// questions -> result. Everything the player types stays on their phone; only
// anonymous totals (city, gender, the eight answers) are sent when a round
// finishes, and the result is always shown even if counting fails.

type Step = "intro" | "about" | "city" | "quiz" | "result";

const CARD =
  "rounded-[28px] border border-[#dcebe6] bg-white p-5 shadow-[0_18px_40px_-28px_rgba(7,41,39,0.45)] sm:p-7";
const PRIMARY =
  "inline-flex w-full items-center justify-center rounded-full bg-teal-700 px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-teal-700/40";
const SECONDARY =
  "inline-flex w-full items-center justify-center rounded-full border-2 border-teal-700/25 bg-white px-6 py-3 text-base font-bold text-teal-800 transition hover:border-teal-700";

function Brand({ dark = false }: { dark?: boolean }) {
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
        <span className={`block text-[17px] font-extrabold ${dark ? "text-white" : "text-ink-900"}`}>Family Medic</span>
        <span className={`block text-[10px] font-bold tracking-[0.22em] ${dark ? "text-teal-100/70" : "text-teal-700"}`}>
          HABIT AGE
        </span>
      </span>
    </div>
  );
}

function ProgressBar({ index }: { index: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {QUESTIONS.map((q, i) => (
        <span key={q.id} className={`h-2 flex-1 rounded-full ${i <= index ? "bg-teal-700" : "bg-[#d2e9e5]"}`} />
      ))}
    </div>
  );
}

function Ring({ value, label, score }: { value: number; label: string; score: number }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const f = Math.max(0.04, Math.min(1, score / 100));
  return (
    <div className="relative mx-auto h-[210px] w-[210px] sm:h-[230px] sm:w-[230px]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="14" />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="#ffb454"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-6xl font-extrabold leading-none text-white sm:text-7xl" data-testid="habit-age-value">
          {value}
        </span>
        <span className="mt-2 text-xs font-bold tracking-[0.22em] text-teal-100/80">{label}</span>
      </div>
    </div>
  );
}

export default function HabitAgeGame() {
  const [step, setStep] = useState<Step>("intro");
  const [profile, setProfile] = useState<HabitProfile | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageText, setAgeText] = useState("");
  const [cityId, setCityId] = useState<number | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [cityProvince, setCityProvince] = useState<string | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<HabitCity[]>([]);
  const [citiesState, setCitiesState] = useState<"loading" | "ready" | "failed">("loading");
  const [league, setLeague] = useState<LeagueData | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(QUESTION_COUNT).fill(null));
  const [result, setResult] = useState<RoundResult | null>(null);
  const [countedNote, setCountedNote] = useState<"counted" | "already" | "not_counted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot: real people never see or fill this
  const startedAt = useRef<number>(0);
  const roundTracked = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // First visit: restore the saved details, count the visit (once per session), load the lists.
  useEffect(() => {
    // Saved details live in the phone's storage, which can only be read in the browser after the first render.
    void Promise.resolve().then(() => {
      const p = loadProfile();
      if (p) {
        setProfile(p);
      }
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
    roundTracked.current = false;
    setStep("quiz");
    trackHabitEvent("start");
    roundTracked.current = true;
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
    }
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
    setCityId(c.id);
    setCityName(c.name);
    setCityProvince(c.province);
    setCityTouched(true);
    setQuery("");
  }
  function pickOther() {
    setCityId(null);
    setCityName(null);
    setCityProvince(null);
    setCityTouched(true);
    setQuery("");
  }

  function submitCity() {
    if (!gender) return;
    startQuiz(Number(ageText), gender, cityId, cityName, cityProvince);
  }

  // answers[] holds the POSITION of the picked option (some options share points)
  function choose(optionIndex: number) {
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
    setResult(res);
    setStep("result");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });

    // One counted round per device per day. Playing again is still fine, it just is not counted twice.
    const today = pakistanToday();
    const last = loadLast();
    const wasPlayer = hasPlayedBefore();
    if (last && last.day === today) {
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
      <div className={CARD}>
        <Brand />
        <h2 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-4xl">
          How old are your <span className="text-teal-700">habits</span>?
        </h2>
        <p className="mt-3 text-base leading-relaxed text-ink-500">
          Answer 8 quick questions about everyday habits and get your Habit Age. Then see how your city is doing.
          Takes about a minute.
        </p>
        <ul className="mt-5 grid gap-2 text-sm font-semibold text-ink-700">
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ffb454]" /> Free, no sign-up
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ffb454]" /> No names, no phone numbers
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ffb454]" /> Just for fun, not a medical test
          </li>
        </ul>
        {gameOff ? (
          <p className="mt-6 rounded-2xl bg-[#fff6e8] p-4 text-sm font-semibold text-[#7a4a00]">
            Habit Age is taking a short break. Please come back soon.
          </p>
        ) : (
          <div className="mt-7 grid gap-3">
            {profile ? (
              <>
                <button type="button" className={PRIMARY} onClick={playAsSaved} data-testid="habit-play-saved">
                  Play again{cityLine ? ` as ${cityLine}` : ""}
                </button>
                <button type="button" className={SECONDARY} onClick={beginSetup} data-testid="habit-change-details">
                  Change my details
                </button>
              </>
            ) : (
              <button type="button" className={PRIMARY} onClick={beginSetup} data-testid="habit-start">
                Start the quiz
              </button>
            )}
          </div>
        )}
        <Link
          href="/habit-age/league"
          className="mt-5 block text-center text-sm font-bold text-teal-700 underline underline-offset-4"
        >
          See the city league
        </Link>
        <p className="mt-5 text-center text-xs leading-relaxed text-ink-400">
          A fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    );
  }

  if (step === "about") {
    return (
      <div className={CARD}>
        <p className="text-xs font-extrabold tracking-[0.18em] text-teal-700">STEP 1 OF 2 · ABOUT YOU</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">A little about you</h2>
        <p className="mt-2 text-sm text-ink-500">Used only for the city and gender totals. It is never tied to your name.</p>

        <p className="mt-6 text-xs font-extrabold tracking-[0.16em] text-teal-700">I AM</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gender">
          {GENDER_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              role="radio"
              aria-checked={gender === g.value}
              onClick={() => setGender(g.value)}
              className={`rounded-full border-2 px-2 py-3.5 text-sm font-bold transition ${
                gender === g.value ? "border-teal-700 bg-[#e6f5f2] text-ink-900" : "border-[#d2e9e5] bg-white text-ink-700 hover:border-teal-600"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <label htmlFor="habit-age-input" className="mt-6 block text-xs font-extrabold tracking-[0.16em] text-teal-700">
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
          className="mt-2 w-full rounded-2xl border-2 border-[#d2e9e5] bg-white px-5 py-3.5 text-lg font-bold text-ink-900 outline-none focus:border-teal-700"
        />
        <p className="mt-2 text-xs text-ink-400">Habit Age is for adults, {MIN_AGE} and over.</p>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        <div className="mt-7 grid gap-3">
          <button type="button" className={PRIMARY} onClick={submitAbout} data-testid="habit-about-next">
            Next
          </button>
          <button type="button" className="text-sm font-bold text-ink-500 underline underline-offset-4" onClick={() => setStep("intro")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "city") {
    return (
      <div className={CARD}>
        <p className="text-xs font-extrabold tracking-[0.18em] text-teal-700">STEP 2 OF 2 · YOUR CITY</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">Which city are you in?</h2>
        <p className="mt-2 text-sm text-ink-500">Your answers count towards your city in the league. Pick a province to narrow the list, or just type.</p>

        <div className="-mx-1 mt-5 flex flex-wrap gap-2">
          {PROVINCE_CHIPS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={provinceFilter === p.value}
              onClick={() => setProvinceFilter(provinceFilter === p.value ? null : p.value)}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition ${
                provinceFilter === p.value ? "border-teal-700 bg-[#e6f5f2] text-ink-900" : "border-[#d2e9e5] bg-white text-ink-700 hover:border-teal-600"
              }`}
            >
              {p.label}
            </button>
          ))}
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
          className="mt-4 w-full rounded-2xl border-2 border-[#d2e9e5] bg-white px-5 py-3.5 text-base font-semibold text-ink-900 outline-none focus:border-teal-700"
        />

        {citiesState === "failed" && (
          <p className="mt-3 rounded-xl bg-[#fff6e8] px-4 py-3 text-sm font-semibold text-[#7a4a00]">
            We could not load the city list right now. You can still play: choose &quot;Other&quot; below.
          </p>
        )}

        <ul className="mt-3 grid gap-2" data-testid="habit-city-results">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => pickCity(c)}
                className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition ${
                  cityId === c.id ? "border-teal-700 bg-[#e6f5f2]" : "border-[#d2e9e5] bg-white hover:border-teal-600"
                }`}
              >
                <span className="text-base font-bold text-ink-900">{c.name}</span>
                <span className="text-xs font-bold text-teal-700">{provinceLabel(c.province)}</span>
              </button>
            </li>
          ))}
          {query.trim() && matches.length === 0 && citiesState === "ready" && (
            <li className="rounded-2xl bg-[#f2fbf9] px-4 py-3 text-sm text-ink-500">
              No city found. Try another spelling, or choose &quot;Other&quot;.
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={pickOther}
              className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition ${
                cityTouched && cityId === null ? "border-teal-700 bg-[#e6f5f2]" : "border-dashed border-[#b4d6d1] bg-white hover:border-teal-600"
              }`}
            >
              <span className="text-base font-bold text-ink-900">Other / my city is not listed</span>
              <span className="text-xs font-semibold text-ink-400">not counted in a city</span>
            </button>
          </li>
        </ul>

        {cityTouched && (
          <p className="mt-4 rounded-2xl bg-[#e6f5f2] px-4 py-3 text-sm font-bold text-teal-800" data-testid="habit-city-chosen">
            {cityName ? `Playing for ${cityName}, ${cityProvince}` : "Playing without a city"}
          </p>
        )}

        <div className="mt-6 grid gap-3">
          <button type="button" className={PRIMARY} onClick={submitCity} disabled={!cityTouched} data-testid="habit-city-next">
            Start the 8 questions
          </button>
          <button type="button" className="text-sm font-bold text-ink-500 underline underline-offset-4" onClick={() => setStep("about")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "quiz") {
    const q = QUESTIONS[qIndex];
    const chosen = answers[qIndex];
    return (
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <Brand />
          <span className="text-sm font-bold text-teal-700">Fun quiz</span>
        </div>
        <div className="mt-5">
          <ProgressBar index={qIndex} />
          <p className="mt-2 flex justify-between text-xs font-bold text-ink-400">
            <span>
              Question {qIndex + 1} of {QUESTION_COUNT}
            </span>
          </p>
        </div>
        <h2 className="mt-4 text-2xl font-extrabold leading-snug tracking-tight text-ink-900 sm:text-[28px]" data-testid="habit-question">
          {q.text}
        </h2>
        {q.hint && <p className="mt-2 text-sm text-ink-500">{q.hint}</p>}
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
                className={`flex items-center gap-4 rounded-2xl border-2 px-4 py-4 text-left text-base font-bold transition ${
                  on ? "border-teal-700 bg-[#e6f5f2] text-ink-900" : "border-[#d2e9e5] bg-white text-ink-700 hover:border-teal-600"
                }`}
              >
                <span
                  className={`h-6 w-6 flex-none rounded-full border-2 ${on ? "border-teal-700 bg-teal-700 shadow-[inset_0_0_0_4px_#e6f5f2]" : "border-[#b4d6d1]"}`}
                  aria-hidden="true"
                />
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="mt-6 grid gap-3">
          <button type="button" className={PRIMARY} onClick={nextQuestion} disabled={chosen === null} data-testid="habit-next">
            {qIndex === QUESTION_COUNT - 1 ? "See my Habit Age" : "Next"}
          </button>
          {qIndex > 0 && (
            <button type="button" className="text-sm font-bold text-ink-500 underline underline-offset-4" onClick={() => setQIndex(qIndex - 1)}>
              Back
            </button>
          )}
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
  const diff = cityAvg !== null ? r.score - cityAvg : null;
  return (
    <div className="overflow-hidden rounded-[28px] bg-[radial-gradient(700px_300px_at_85%_-10%,rgba(45,212,191,0.25),transparent_60%),linear-gradient(170deg,#0b4540,#072927)] p-5 text-white shadow-[0_24px_50px_-28px_rgba(7,41,39,0.7)] sm:p-8">
      <Brand dark />
      <h2 className="mt-6 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
        Today your habits look <span className="text-[#ffb454]">{r.habitAge}</span>
      </h2>
      <div className="mt-5">
        <Ring value={r.habitAge} label="HABIT AGE" score={r.score} />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2.5 text-center">
        {[
          { v: r.realAge, l: "Real age" },
          { v: r.habitAge, l: "Habit Age" },
          { v: r.score, l: "Habit Score" },
        ].map((t) => (
          <div key={t.l} className="rounded-2xl bg-white/10 px-2 py-4">
            <div className="text-3xl font-extrabold">{t.v}</div>
            <div className="mt-0.5 text-xs font-bold text-teal-100/80 sm:text-sm">{t.l}</div>
          </div>
        ))}
      </div>

      {cityLine && (
        <div className="mt-3 rounded-2xl bg-[#ffb454] p-4 text-[#3b2500]">
          <p className="text-[11px] font-extrabold tracking-[0.16em]">YOUR CITY · {cityLine.toUpperCase()}</p>
          {cityAvg !== null ? (
            <>
              <p className="mt-1 text-xl font-extrabold">City average score: {cityAvg}</p>
              <p className="text-sm font-bold">
                {diff !== null && diff > 0
                  ? "You're above your city's average. Nice!"
                  : diff !== null && diff === 0
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
        {r.best && (
          <div className="rounded-2xl bg-white p-4 text-ink-900">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">TODAY&apos;S BEST HABIT</p>
            <p className="mt-1 text-base font-bold sm:text-lg">{r.best.praise}</p>
          </div>
        )}
        <div className="rounded-2xl bg-white p-4 text-ink-900">
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-teal-700">ONE SMALL IDEA</p>
          <p className="mt-1 text-base font-bold sm:text-lg">{r.idea.tip}</p>
        </div>
      </div>

      {countedNote === "already" && (
        <p className="mt-3 text-center text-xs font-semibold text-teal-100/80">
          Your round for today is already in the league. Play again as often as you like for fun.
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={openShare}
          className="inline-flex items-center justify-center rounded-full bg-[#ffb454] px-6 py-3.5 text-base font-extrabold text-[#3b2500] transition hover:bg-[#ffc272]"
          data-testid="habit-share"
        >
          Share my card
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("intro");
            if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          }}
          className="inline-flex items-center justify-center rounded-full border-2 border-white/50 px-6 py-3 text-base font-bold text-white transition hover:border-white"
          data-testid="habit-again"
        >
          Play again
        </button>
      </div>

      {shareOpen && (
        <div className="mt-4 rounded-2xl bg-white/10 p-3" data-testid="habit-share-panel">
          <canvas ref={canvasRef} className="mx-auto w-full max-w-[320px] rounded-xl" aria-label="Your Habit Age share card" />
          <button
            type="button"
            onClick={doShare}
            disabled={sharing}
            className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 text-base font-extrabold text-[#0a3733] disabled:opacity-60"
          >
            {sharing ? "Getting your card ready…" : "Share or save picture"}
          </button>
          {shareMsg && <p className="mt-2 text-center text-sm font-semibold text-teal-100">{shareMsg}</p>}
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
        <p className="mt-2 text-xs leading-relaxed text-teal-100/70">
          This is a fun estimate of daily habits, not a medical assessment. Not for emergencies.
        </p>
      </div>
    </div>
  );
}
