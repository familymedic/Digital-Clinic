-- Site traffic tracking (2026-09-15) — the physician asked for a way to
-- see how the business is doing: page views, roughly how many distinct
-- visitors, and which pages get reached, so an admin "Business metrics"
-- page can show real numbers instead of nothing. First-party and
-- deliberately minimal:
-- - No IP address is stored, no third-party analytics account or
--   script is used (nothing to sign up for, no data leaving Supabase).
-- - `visitor_id` is a random id the browser generates itself and keeps
--   in localStorage (see PageViewTracker.tsx) — not tied to a patient or
--   doctor account, not a cookie, and not usable to identify a real
--   person. It only lets the dashboard tell "10 views from 1 visitor"
--   apart from "10 views from 10 visitors" on the same device.
-- - Only the PUBLIC marketing/booking-entry pages are ever logged (the
--   tracker component itself decides which paths to send) — never
--   inside the logged-in patient dashboard, the doctor workspace, the
--   admin screens, or any `/consultation/*` page. That boundary is
--   enforced in the app, not the database, but it matters enough to
--   restate here: this table exists to answer "how many people found
--   the site and started booking," never "what did a specific patient
--   or doctor do once signed in."
--
-- RLS mirrors the one other write-heavy, low-sensitivity pattern in this
-- app (consultation_messages-style: a real policy, not a blanket
-- open table) — anyone (including a signed-out visitor) can INSERT a
-- page-view row for themselves, but nobody except an admin can ever
-- read this table back. A page view is trivially spoofable by anyone
-- who really wants to (same as any client-reported analytics event,
-- with or without a third-party script) — acceptable for a small
-- practice's own directional traffic numbers, not something this table
-- is trying to make tamper-proof.

create table if not exists public.site_page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  referrer_host text,
  visitor_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_page_views_created_at_idx on public.site_page_views (created_at);

alter table public.site_page_views enable row level security;

drop policy if exists "Anyone can record a page view" on public.site_page_views;
create policy "Anyone can record a page view"
  on public.site_page_views for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can view page views" on public.site_page_views;
create policy "Admins can view page views"
  on public.site_page_views for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Occasional cleanup of old rows is a reasonable thing for an admin to
-- want later (this table only ever grows); giving admin a DELETE policy
-- now costs nothing and avoids a future migration just for that.
drop policy if exists "Admins can delete page views" on public.site_page_views;
create policy "Admins can delete page views"
  on public.site_page_views for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));
