-- Phase 9, step 1: real audio/video call delivery via Daily.co
-- (Section 23's "consultation vendor" gap, decided 2026-09-12 — Daily,
-- per the cost/complexity principle: a plain REST API with a single
-- API key, a free tier that covers this practice's likely volume, and
-- native audio-only pricing/support, so text stays on the messaging
-- system built earlier and only audio/video need a real call).
--
-- Unlike the Resend email integration (0012), room creation here is
-- NOT done from a database trigger via pg_net. pg_net is
-- fire-and-forget/asynchronous — fine for "send an email, don't wait
-- for the result," wrong for "create a room and get back the URL to
-- store," which needs the response. That's done instead from a new
-- Next.js server route (see src/app/api/consultations/[id]/room/),
-- which can make a normal synchronous HTTP call to Daily and write the
-- result back. Section 23's "video session security" is handled the
-- same way every future join does: the route mints a fresh, short-lived
-- Daily meeting token per join request rather than ever exposing a
-- bare, indefinitely-reusable room link.
--
-- These two columns are therefore deliberately given NO column-level
-- grant to `authenticated` at all — neither a patient nor the doctor
-- can set them directly from the browser, the same defense-in-depth
-- pattern used throughout this schema (0014/0015/0020/0021). The only
-- way they're ever written is through the server route below, using
-- the Supabase service role key (which bypasses grants/RLS entirely,
-- same as any Supabase admin operation) — and only after that route
-- has confirmed, via the requesting user's OWN token and the existing
-- consultations RLS policies, that they're actually the patient or the
-- assigned doctor for that specific consultation.
alter table public.consultations
  add column if not exists video_room_name text,
  add column if not exists video_room_url text,
  add column if not exists video_room_created_at timestamptz;

-- No grant statement here is deliberate — see above. (A prior
-- migration's revoke-then-grant on this table, 0015, already leaves
-- these two new columns outside the authenticated INSERT grant by
-- default; nothing further is needed to keep them out of the UPDATE
-- grant either, since 0014's UPDATE grant is likewise an explicit,
-- narrow column list that these aren't part of.)
