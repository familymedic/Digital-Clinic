import { NextResponse } from "next/server";
import { habitAnonClient } from "@/lib/habitServer";

// Habit Age: the public city league and past weekly winners. Read-only and
// cached for a minute at the edge so a busy day costs the database almost
// nothing. Entry counts are included only when the admin has switched them on.

export const maxDuration = 15;

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET() {
  const anon = habitAnonClient();
  if (!anon) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const [league, winners] = await Promise.all([
    anon.rpc("habit_public_league"),
    anon.rpc("habit_public_winners", { p_limit: 8 }),
  ]);
  if (league.error || !league.data) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { league: league.data, winners: Array.isArray(winners.data) ? winners.data : [] },
    { headers: { "Cache-Control": CACHE } }
  );
}
