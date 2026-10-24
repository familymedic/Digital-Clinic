import { NextResponse } from "next/server";
import { habitAnonClient } from "@/lib/habitServer";

// Habit Age: the list of cities people can pick from (a few hundred short
// rows). Cached for an hour; it only changes when an admin adds a city.

export const maxDuration = 15;

export async function GET() {
  const anon = habitAnonClient();
  if (!anon) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data, error } = await anon
    .from("habit_cities")
    .select("id,name,province")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(2000);
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ cities: data }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
