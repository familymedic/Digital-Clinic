-- Installed-app tracking for the admin "Business metrics" page
-- (2026-10-04, physician: "can we add to the metrics data related to
-- how many users downloaded the user friendly app?").
--
-- "The app" is the free installable web app (PWA, 2026-09-30) — there is
-- no app-store download, so there is no store dashboard to read installs
-- from. The only honest way to count them is for the site itself to
-- notice, and browsers expose two usable signals:
--   1. 'installed'  - the browser's own `appinstalled` event, fired when
--      someone installs the app. Chrome/Edge/Android only. iPhone Safari
--      never fires it (Apple offers no programmatic install signal), so
--      iPhone installs can't be seen at this moment.
--   2. 'app_opened' - the site loaded while running as an installed app
--      (display-mode: standalone). This works on iPhone too, and it also
--      catches people who installed BEFORE this tracking existed, so
--      their first open after this ships makes them show up.
-- Together these give "people who have the app", though never a perfect
-- count: an uninstall can't be detected, and someone who clears their
-- browser storage or uses two devices is counted more than once. The
-- admin page says so.
--
-- Mirrors site_page_views (0036) deliberately — same privacy posture:
-- first-party, no IP address, no third-party analytics, `visitor_id` is
-- the same random per-browser id PageViewTracker already uses (not tied
-- to a patient/doctor account, not usable to identify anyone). Unlike
-- page views, this table records NO page path at all — it can't say
-- what anyone did inside the app, only that the installed app was used.
--
-- RLS: anyone (including signed-out) can INSERT an event; only an admin
-- can read or delete. The CHECK constraints keep arbitrary junk out of
-- the two enumerated columns.

create table if not exists public.app_install_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('installed', 'app_opened')),
  platform text not null default 'other' check (platform in ('android', 'ios', 'desktop', 'other')),
  visitor_id text not null check (char_length(visitor_id) between 1 and 100),
  created_at timestamptz not null default now()
);

create index if not exists app_install_events_created_at_idx on public.app_install_events (created_at);
create index if not exists app_install_events_visitor_idx on public.app_install_events (visitor_id);

alter table public.app_install_events enable row level security;

drop policy if exists "Anyone can record an app install event" on public.app_install_events;
create policy "Anyone can record an app install event"
  on public.app_install_events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can view app install events" on public.app_install_events;
create policy "Admins can view app install events"
  on public.app_install_events for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete app install events" on public.app_install_events;
create policy "Admins can delete app install events"
  on public.app_install_events for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));
