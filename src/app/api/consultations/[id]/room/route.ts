import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Phase 9, step 1: mints (or reuses) a Daily.co video/audio room for a
// consultation, and returns a short-lived, per-person join link.
//
// Authorization deliberately reuses the database's own RLS rather than
// reimplementing access rules here: the request is first run through a
// Supabase client authenticated AS THE CALLING USER (their own access
// token, passed from the client). If that user's own SELECT policy on
// `consultations` doesn't return this row, they are not the patient or
// the assigned doctor for it — full stop, same rule the rest of the
// app already relies on. Only after that check passes does this route
// switch to the Supabase SERVICE ROLE client to write the room details
// back (video_room_name/url have no column-level grant for anyone —
// see 0023 — so this server-side write is the only way they're ever
// set).
//
// Room creation itself can't be exercised against a real Daily.co
// account in Claude's own environment (Section 41 — Claude cannot
// create third-party accounts). Until DAILY_API_KEY is configured,
// this route fails clearly rather than pretending to work — the same
// graceful-degradation choice made for Resend in 0012, adapted to a
// request/response route instead of a fire-and-forget trigger.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DAILY_API_KEY = process.env.DAILY_API_KEY;

interface ConsultationForRoom {
  id: string;
  delivery_mode: "text" | "audio" | "video";
  status: string;
  doctor_id: string | null;
  video_room_name: string | null;
  video_room_url: string | null;
  patient: { full_name: string } | { full_name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: consultationId } = await context.params;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // A client acting AS the calling user — every query below is subject
  // to that user's own RLS, exactly as if their browser had made it.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 });
  }

  const { data: consultation, error: fetchError } = await userClient
    .from("consultations")
    .select("id, delivery_mode, status, doctor_id, video_room_name, video_room_url, patient:family_members(full_name)")
    .eq("id", consultationId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!consultation) {
    // Either it doesn't exist, or it isn't this user's — RLS makes
    // those look the same, which is the correct, safe default.
    return NextResponse.json({ error: "This consultation isn't available to you." }, { status: 404 });
  }
  const row = consultation as unknown as ConsultationForRoom;

  if (row.delivery_mode === "text") {
    return NextResponse.json({ error: "This consultation doesn't use a video/audio call." }, { status: 400 });
  }
  if (row.status === "completed") {
    return NextResponse.json({ error: "This consultation has already been completed." }, { status: 400 });
  }
  if (!DAILY_API_KEY) {
    return NextResponse.json(
      { error: "Video calling isn't configured yet — the clinic needs to finish setting this up." },
      { status: 503 }
    );
  }

  const isDoctor = row.doctor_id === user.id;
  const patient = one(row.patient);

  let roomName = row.video_room_name;
  let roomUrl = row.video_room_url;

  if (!roomName || !roomUrl) {
    const roomNameToCreate = `consult-${row.id}`;
    const dailyRes = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: roomNameToCreate,
        privacy: "private",
        properties: {
          max_participants: 2,
          start_video_off: row.delivery_mode === "audio",
          // Rooms expire 6 hours from first creation — plenty for a
          // consultation that overruns, without rooms accumulating
          // forever for visits that never happened.
          exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
        },
      }),
    });

    let createdRoom: { name: string; url: string };

    if (dailyRes.ok) {
      createdRoom = await dailyRes.json();
    } else {
      const detail = await dailyRes.text();
      // The room name is deterministic (consult-<consultation id>), so
      // "already exists" isn't necessarily a real error — it happens
      // whenever this route runs twice for the same consultation before
      // the first run's database write lands (e.g. the page's own
      // effect firing twice, the patient opening the call in two tabs,
      // or a prior attempt that created the Daily room but failed
      // before saving it here). Rather than fail the second caller,
      // treat this specific case as "someone already created it" and
      // fetch the existing room instead of erroring out — makes room
      // creation idempotent instead of a race.
      let existingRoom: { name: string; url: string } | null = null;
      if (dailyRes.status === 400 && /already exists/i.test(detail)) {
        const existingRes = await fetch(`https://api.daily.co/v1/rooms/${roomNameToCreate}`, {
          headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
        });
        if (existingRes.ok) {
          existingRoom = await existingRes.json();
        }
      }
      if (!existingRoom) {
        return NextResponse.json(
          { error: `Couldn't create the video room (Daily.co said: ${detail}).` },
          { status: 502 }
        );
      }
      createdRoom = existingRoom;
    }

    roomName = createdRoom.name;
    roomUrl = createdRoom.url;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Video calling isn't fully configured yet — the clinic needs to finish setting this up." },
        { status: 503 }
      );
    }
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: writeError } = await serviceClient
      .from("consultations")
      .update({
        video_room_name: roomName,
        video_room_url: roomUrl,
        video_room_created_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (writeError) {
      return NextResponse.json({ error: `Room created but couldn't be saved: ${writeError.message}` }, { status: 500 });
    }
  }

  // A fresh, short-lived token every time someone joins — never a
  // bare, indefinitely-reusable room link (Section 23's "video session
  // security" flag).
  const tokenRes = await fetch("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: isDoctor,
        user_name: isDoctor ? "Doctor" : patient?.full_name ?? "Patient",
        exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
      },
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return NextResponse.json(
      { error: `Couldn't create your join link (Daily.co said: ${detail}).` },
      { status: 502 }
    );
  }

  const tokenData = await tokenRes.json();
  return NextResponse.json({ joinUrl: `${roomUrl}?t=${tokenData.token}` });
}
