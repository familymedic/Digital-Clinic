import { NextRequest, NextResponse } from "next/server";
import { habitClientIp, habitServiceClient, makeLimiter } from "@/lib/habitServer";

// Habit Age: a simple anonymous counter (visit, start, share, doctor_tap,
// channel_tap). Always answers 204 so a counter problem is never visible.

export const maxDuration = 10;

const limited = makeLimiter(300, 60 * 60 * 1000);
const EVENTS = new Set(["visit", "start", "share", "doctor_tap", "channel_tap"]);

export async function POST(request: NextRequest) {
  const done = () => new NextResponse(null, { status: 204 });
  try {
    if (limited(habitClientIp(request))) return done();
    const text = await request.text();
    if (text.length > 256) return done();
    const b = JSON.parse(text) as Record<string, unknown>;
    const event = String(b.event ?? "");
    if (!EVENTS.has(event)) return done();
    const service = habitServiceClient();
    if (!service) return done();
    await service.rpc("habit_event", { p_event: event });
  } catch {
    // ignore
  }
  return done();
}
