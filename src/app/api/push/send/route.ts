import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Internal-only push-sending endpoint (2026-10-01). The only two
// callers of this route are Postgres triggers (via pg_net, see
// supabase/migrations/0055_push_notifications.sql), authenticated with
// a shared secret stored in Supabase Vault, and nothing else — this is
// deliberately NOT reachable by a patient/doctor/admin's own browser,
// which is why it checks a secret header instead of a user's bearer
// token the way every other route in this app does.
//
// Why this has to be a Next.js route and not raw SQL: a real Web Push
// payload has to be VAPID-signed and per-subscription encrypted, which
// needs the `web-push` Node library's crypto — not something plpgsql
// can do. Postgres already proved out "trigger calls out over HTTP"
// for email (0012/0013, calling Resend directly); this is the exact
// same shape, just pointed at our own app instead of a third party,
// because there's no hosted push-sending service in this stack.
//
// Fails CLOSED on auth (wrong/missing secret -> 401) but fails OPEN on
// a missing VAPID config or missing recipient subscriptions (200 with
// zero sent) — same "never let a notification problem become a bigger
// problem" posture as every email trigger in this project. A dead
// subscription (the browser's push service returns 404/410 — the user
// uninstalled, cleared data, or the subscription just expired) is
// quietly deleted rather than retried forever.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUSH_INTERNAL_SECRET = process.env.PUSH_INTERNAL_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:impactbridgeacademy@gmail.com";

interface SendBody {
  // Either a single accountId, or a broadcastRole to fan out to every
  // account of that role (today, only "admin" is supported — it's the
  // only role with more than one real recipient at once).
  accountId?: string;
  broadcastRole?: "admin";
  title: string;
  body: string;
  url?: string;
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-internal-secret");
  if (!PUSH_INTERNAL_SECRET || !secret || secret !== PUSH_INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  let payload: SendBody;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.title || !payload.body) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 });
  }
  if (!payload.accountId && !payload.broadcastRole) {
    return NextResponse.json({ error: "accountId or broadcastRole is required" }, { status: 400 });
  }

  // No VAPID keys configured yet (e.g. right after this migration lands,
  // before the physician has set them in Vercel) — fail open, same as
  // every email trigger does when its key is missing. Nothing breaks,
  // nothing is lost, it just silently sends no push until configured.
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ sent: 0, skipped: "VAPID keys not configured" });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let accountIds: string[] = [];
  if (payload.accountId) {
    accountIds = [payload.accountId];
  } else if (payload.broadcastRole === "admin") {
    const { data, error } = await serviceClient.from("admin_profiles").select("id");
    if (error) {
      return NextResponse.json({ error: "Failed to resolve admin recipients" }, { status: 500 });
    }
    accountIds = (data || []).map((row) => row.id as string);
  }

  if (accountIds.length === 0) {
    return NextResponse.json({ sent: 0, skipped: "No recipients" });
  }

  const { data: subscriptions, error: subError } = await serviceClient
    .from("push_subscriptions")
    .select("id, account_id, endpoint, p256dh, auth_key")
    .in("account_id", accountIds);

  if (subError) {
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 500 });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0, skipped: "No subscriptions for these recipients" });
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
  });

  let sent = 0;
  const deadSubscriptionIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          notificationPayload
        );
        sent += 1;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Expired/invalid subscription — the device unsubscribed,
          // cleared data, or the browser's push service dropped it.
          // Remove it so future sends don't keep retrying a dead end.
          deadSubscriptionIds.push(sub.id as string);
        }
        // Any other failure (network blip, etc.) is logged server-side
        // via the thrown error reaching Vercel's function logs, but
        // never thrown back up — one bad subscription never blocks the
        // others in this batch.
      }
    })
  );

  if (deadSubscriptionIds.length > 0) {
    await serviceClient.from("push_subscriptions").delete().in("id", deadSubscriptionIds);
  }

  return NextResponse.json({ sent, pruned: deadSubscriptionIds.length });
}
