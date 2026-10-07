import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side half of the site-health system (2026-10-07): records an event
// in `client_events` and, when the same problem keeps happening, alerts an
// admin by push notification and email. Everything here FAILS OPEN — a
// monitoring problem must never become a user-facing problem.

export interface ServerEvent {
  source: "client" | "server";
  kind: "slow" | "fail" | "timeout" | "js_error" | "server_error";
  label: string;
  message?: string | null;
  durationMs?: number | null;
  page?: string | null;
  effectiveType?: string | null;
  saveData?: boolean | null;
  online?: boolean | null;
  userAgent?: string | null;
}

export const RETENTION_DAYS = 7;
const WINDOW_MIN = 15; // how far back we look for "the same problem again"
const COOLDOWN_MIN = 60; // at most one alert per problem per hour

function thresholdFor(ev: ServerEvent): number {
  if (ev.source === "server") return 1; // registrations/payments are rare: every server failure matters
  if (ev.kind === "fail" || ev.kind === "timeout") return 2;
  return 3; // slow, js_error
}

export async function recordEvent(service: SupabaseClient, ev: ServerEvent, origin?: string): Promise<void> {
  try {
    const { data } = await service
      .from("client_events")
      .insert({
        source: ev.source,
        kind: ev.kind,
        label: ev.label,
        message: ev.message ?? null,
        duration_ms: ev.durationMs ?? null,
        page: ev.page ?? null,
        effective_type: ev.effectiveType ?? null,
        save_data: ev.saveData ?? null,
        online: ev.online ?? null,
        user_agent: ev.userAgent ?? null,
      })
      .select("id")
      .single();

    // Housekeeping: keep 7 days only (older reports are not useful). Cheap;
    // runs on ~10% of inserts, and migration 0066 also schedules a daily purge.
    if (Math.random() < 0.1) {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
      await service.from("client_events").delete().lt("created_at", cutoff);
    }

    await maybeAlert(service, ev, (data as { id?: string } | null)?.id, origin);
  } catch (err) {
    console.error("recordEvent failed (ignored):", err);
  }
}

async function maybeAlert(service: SupabaseClient, ev: ServerEvent, eventId: string | undefined, origin?: string) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await service
    .from("client_events")
    .select("id", { count: "exact", head: true })
    .eq("label", ev.label)
    .eq("kind", ev.kind)
    .gte("created_at", since);
  if ((count ?? 0) < thresholdFor(ev)) return;

  const cooldownSince = new Date(Date.now() - COOLDOWN_MIN * 60_000).toISOString();
  const { count: alreadyAlerted } = await service
    .from("client_events")
    .select("id", { count: "exact", head: true })
    .eq("label", ev.label)
    .eq("alerted", true)
    .gte("created_at", cooldownSince);
  if ((alreadyAlerted ?? 0) > 0) return;

  if (eventId) await service.from("client_events").update({ alerted: true }).eq("id", eventId);

  const title =
    ev.source === "server" ? "Family Medic: a server error needs a look" : "Family Medic: the site is lagging for users";
  const kindWord =
    ev.kind === "timeout" ? "timing out" : ev.kind === "slow" ? "slow" : ev.kind === "js_error" ? "erroring" : "failing";
  const body = `${ev.label} is ${kindWord} (${count} reports in ${WINDOW_MIN} min). Open Admin → Site health.`;

  await Promise.allSettled([sendPush(title, body, origin), sendEmail(title, body, ev, count ?? 0)]);
}

async function sendPush(title: string, body: string, origin?: string) {
  const secret = process.env.PUSH_INTERNAL_SECRET;
  if (!secret || !origin) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    await fetch(`${origin}/api/push/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ broadcastRole: "admin", title, body, url: "/admin/site-health" }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function sendEmail(title: string, body: string, ev: ServerEvent, count: number) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const to = process.env.ALERT_EMAIL_TO || "contact@thefamilymedic.com";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Family Medic <contact@thefamilymedic.com>",
        to: [to],
        subject: title,
        text:
          `${body}\n\nWhat: ${ev.kind} on ${ev.label}\nSeen: ${count} times in the last ${WINDOW_MIN} minutes\n` +
          (ev.message ? `Detail: ${ev.message}\n` : "") +
          `\nOpen the admin area → Site health to see which pages and connection types are affected.`,
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}
