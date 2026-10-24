import { NextRequest, NextResponse } from "next/server";
import { habitClientIp, habitServiceClient, makeLimiter } from "@/lib/habitServer";

// Habit Age: one finished round. Counted anonymously (city + gender + the
// eight answers, added into daily totals; nothing that identifies a person
// is stored). Defensive on purpose because it is public:
//  - tiny body cap and strict validation
//  - honeypot field and a minimum time on the quiz: those requests are
//    quietly "accepted" without being counted, so a bot learns nothing
//  - per-IP limit; the database function is callable only by the server key
// The player always sees their own result on screen whether or not the
// round was counted, so a counting problem never spoils the game.

export const maxDuration = 15;

const limited = makeLimiter(60, 60 * 60 * 1000); // 60 rounds / hour / IP (shared wifi friendly)
const MAX_BODY = 1024;
const MIN_ELAPSED_MS = 6000;

export async function POST(request: NextRequest) {
  const ok = (counted: boolean) => NextResponse.json({ ok: true, counted });
  try {
    if (limited(habitClientIp(request))) {
      return NextResponse.json({ ok: false, error: "slow_down" }, { status: 429 });
    }
    const text = await request.text();
    if (text.length > MAX_BODY) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    const b = JSON.parse(text) as Record<string, unknown>;

    const gender = String(b.gender ?? "");
    if (!["female", "male", "unsaid"].includes(gender)) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const answers = b.answers;
    if (
      !Array.isArray(answers) ||
      answers.length !== 8 ||
      !answers.every((a) => Number.isInteger(a) && (a as number) >= 0 && (a as number) <= 3)
    ) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const cityRaw = b.cityId;
    const cityId = Number.isInteger(cityRaw) && (cityRaw as number) > 0 && (cityRaw as number) < 1_000_000 ? (cityRaw as number) : 0;
    const returning = b.returning === true;

    // Honeypot (a hidden box people never fill) and "too fast to be a person".
    if (typeof b.website === "string" && b.website.trim() !== "") return ok(false);
    const elapsed = Number(b.elapsedMs);
    if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) return ok(false);

    const service = habitServiceClient();
    if (!service) return ok(false);
    const { error } = await service.rpc("habit_submit", {
      p_city_id: cityId,
      p_gender: gender,
      p_answers: answers,
      p_returning: returning,
    });
    if (error) {
      if (String(error.message).includes("game_off")) {
        return NextResponse.json({ ok: false, error: "game_off" }, { status: 403 });
      }
      return ok(false);
    }
    return ok(true);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
