-- Doctor views report for the admin (2026-10-14).
--
-- WHAT: counts how patients interact with each doctor's public listing, so
-- the admin can see (and export to Excel for marketing) numbers per doctor:
--   shown         the doctor's card appeared on the /doctors list
--   card_click    someone clicked a card on that list to open the profile
--   profile_view  the doctor's own profile page was opened
--   book_click    someone pressed a "Book" button for that doctor
-- ADMIN ONLY: nobody but an admin can read these rows or the report; doctors
-- never see them. Anyone (including a signed-out visitor) can ADD an event
-- row, the same pattern as site_page_views (0036).
-- PRIVACY: no IP address, no account id, no name. visitor_id is the same
-- random browser id the traffic tracker already uses. The app skips counting
-- a doctor's own visits to their own listing.
-- ADDITIVE: nothing existing is changed. If this migration is not run, the
-- site works exactly as before (the tracking calls just fail quietly).
-- ROLLBACK: ROLLBACK-0074.sql.

create table if not exists public.doctor_events (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  event text not null check (event in ('shown', 'card_click', 'profile_view', 'book_click')),
  visitor_id text not null check (char_length(visitor_id) between 8 and 80),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now()
);

create index if not exists doctor_events_doctor_idx on public.doctor_events (doctor_id, event, created_at);
create index if not exists doctor_events_created_idx on public.doctor_events (created_at);

alter table public.doctor_events enable row level security;

drop policy if exists "Anyone can record a doctor event" on public.doctor_events;
create policy "Anyone can record a doctor event"
  on public.doctor_events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can view doctor events" on public.doctor_events;
create policy "Admins can view doctor events"
  on public.doctor_events for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete doctor events" on public.doctor_events;
create policy "Admins can delete doctor events"
  on public.doctor_events for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- The per-doctor report. One row for every approved doctor (zeros included).
-- Admin only: any other caller is refused.
create or replace function public.admin_doctor_view_stats(p_from timestamptz, p_to timestamptz)
returns table (
  doctor_id uuid,
  full_name text,
  specialty text,
  shown bigint,
  card_clicks bigint,
  profile_views bigint,
  unique_visitors bigint,
  shared_card_views bigint,
  book_clicks bigint,
  paid_bookings bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles a where a.id = auth.uid()) then
    raise exception 'Admins only.';
  end if;

  return query
  with ev as (
    select e.doctor_id,
           count(*) filter (where e.event = 'shown') as shown,
           count(*) filter (where e.event = 'card_click') as card_clicks,
           count(*) filter (where e.event = 'profile_view') as profile_views,
           count(distinct e.visitor_id) filter (where e.event = 'profile_view') as unique_visitors,
           count(*) filter (where e.event = 'profile_view' and e.source like 'card-%') as shared_card_views,
           count(*) filter (where e.event = 'book_click') as book_clicks
    from public.doctor_events e
    where e.created_at >= p_from and e.created_at < p_to
    group by e.doctor_id
  ), pb as (
    select c.doctor_id, count(*) as paid
    from public.consultations c
    where c.created_at >= p_from and c.created_at < p_to
      and c.status in ('submitted', 'completed')
    group by c.doctor_id
  )
  select d.id, d.full_name, d.specialty,
         coalesce(ev.shown, 0), coalesce(ev.card_clicks, 0), coalesce(ev.profile_views, 0),
         coalesce(ev.unique_visitors, 0), coalesce(ev.shared_card_views, 0), coalesce(ev.book_clicks, 0),
         coalesce(pb.paid, 0)
  from public.doctor_profiles d
  left join ev on ev.doctor_id = d.id
  left join pb on pb.doctor_id = d.id
  where d.verification_status = 'approved'
  order by coalesce(ev.profile_views, 0) desc, d.full_name;
end;
$$;

revoke execute on function public.admin_doctor_view_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_doctor_view_stats(timestamptz, timestamptz) to authenticated;
