import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Uptime check for an external monitor such as UptimeRobot (free). Answers
// 200 only when the website AND its database both respond quickly; 503
// otherwise, so the monitor emails/pushes you the moment either is down or
// very slow. Reads one row of a public view with the public (anon) key —
// no secrets involved and nothing sensitive in the answer.

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const SLOW_DB_MS = 4000;

export async function GET() {
  const started = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const headers = { "Cache-Control": "no-store" };

  if (!url || !key) {
    return NextResponse.json({ ok: false, db: "not_configured" }, { status: 503, headers });
  }

  try {
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const result = await Promise.race([
      db.from("public_doctor_directory").select("id").limit(1),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("db timeout")), SLOW_DB_MS)),
    ]);
    const dbMs = Date.now() - started;
    if (result.error) return NextResponse.json({ ok: false, db: "error", dbMs }, { status: 503, headers });
    return NextResponse.json({ ok: true, db: "ok", dbMs }, { status: 200, headers });
  } catch {
    return NextResponse.json({ ok: false, db: "slow_or_down", dbMs: Date.now() - started }, { status: 503, headers });
  }
}
