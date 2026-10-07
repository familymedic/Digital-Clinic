-- 0066: site-health event log (2026-10-07).
--
-- Why: doctors reported the sign-up page hanging on "Submitting…" and the
-- physician was never told. This table records slow / failed / timed-out
-- requests and JavaScript errors from real users' browsers (and critical
-- server-side failures), so an admin can see what is lagging and for whom,
-- and so an alert can fire when the same problem repeats.
--
-- PRIVACY: technical facts only — an endpoint label with ids stripped, the
-- page path with ids stripped, a duration, a short error text, connection
-- type, browser string. No user id, name, email, token, request body or
-- anything health-related is ever stored here.
--
-- Writes happen only through /api/telemetry and server routes using the
-- service role (no insert policy on purpose). Only admins can read.

create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('client', 'server')),
  kind text not null check (kind in ('slow', 'fail', 'timeout', 'js_error', 'server_error')),
  label text not null,
  message text,
  duration_ms integer,
  page text,
  effective_type text,
  save_data boolean,
  online boolean,
  user_agent text,
  alerted boolean not null default false
);

create index if not exists client_events_created_at_idx on public.client_events (created_at desc);
create index if not exists client_events_label_idx on public.client_events (label, created_at desc);

alter table public.client_events enable row level security;

drop policy if exists "Admins can view client events" on public.client_events;
create policy "Admins can view client events"
  on public.client_events for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete client events" on public.client_events;
create policy "Admins can delete client events"
  on public.client_events for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Keep only the last 7 days: older lag/bug reports are not useful.
-- 1) Purge anything older right now.
delete from public.client_events where created_at < now() - interval '7 days';

-- 2) Purge automatically every day at 03:00 UTC (08:00 Pakistan time).
--    Uses Supabase's built-in pg_cron. If pg_cron can't be enabled on this
--    project the block simply skips (the app also purges old rows by itself
--    whenever new reports arrive and whenever an admin opens Site health).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-client-events';
  perform cron.schedule(
    'purge-client-events',
    '0 3 * * *',
    $job$delete from public.client_events where created_at < now() - interval '7 days'$job$
  );
exception when others then
  raise notice 'pg_cron not available (%): app-side purge will be used instead', sqlerrm;
end
$$;
