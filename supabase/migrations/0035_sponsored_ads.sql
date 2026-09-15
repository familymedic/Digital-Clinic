-- Sponsored ads on the public site (2026-09-15). The physician asked
-- whether pharma companies renting a paid, clearly-labeled ad placement
-- on the home page (an image today, video as a later step) could help
-- with revenue, and whether it's doable. Scoped and confirmed with him
-- before building:
-- 1. Images only for this first build — video is a real follow-up step,
--    not built here, since it needs its own file-size/hosting/autoplay
--    handling and the physician chose to ship the simpler version first
--    (same "ship the essential slice first" approach used for the two
--    calculators before the rest of that list).
-- 2. If more than one sponsor's date range overlaps, the home page shows
--    one at a time and rotates between them — never more than one
--    "Sponsored" card on the page at once, so the layout never changes
--    shape no matter how many sponsors are running.
-- 3. No payment/price tracking in the app at all — the physician
--    negotiates and records what a sponsor pays entirely outside the
--    platform (invoice, bank record); this table only manages the
--    creative and its date range, nothing financial.
--
-- This is a genuinely new, separate concern from the Patient →
-- Consultation → Clinical Record spine (Section 38) — a sponsored ad has
-- no relationship to any patient, doctor, or consultation row at all —
-- so it's built as its own small, additive table with zero foreign keys
-- into clinical data, matching exactly what was anticipated (and
-- deliberately deferred) when the free calculators were built: "a small
-- admin-managed table, no core schema impact."
--
-- Design decisions, stated explicitly:
-- - Only an admin can create/edit/pause/delete an ad — same "EXISTS
--   against admin_profiles" RLS pattern used everywhere else in this
--   app (0025/0026/0027), so a second admin needs no new migration.
-- - The raw table is never exposed to the public directly (it has no
--   anon/authenticated SELECT policy at all) — a public visitor only
--   ever sees a deliberately narrow VIEW (below) filtered to ads that
--   are both status = 'active' AND within their own date range, mirror-
--   ing the public_doctor_directory pattern (0028) for exactly the same
--   reason: a view can express "only the safe, currently-live subset"
--   in a way a blanket column grant cannot.
-- - The uploaded image lives in its own PUBLIC storage bucket
--   ("sponsored-ads") since it has to render on the public home page
--   with no login — same reasoning as the doctor-photos bucket (0034).
--   Still only ever written by a service-role API route, never a direct
--   client storage write, matching every other bucket in this app.
-- - image_url stores the full public URL (computed once, at upload
--   time, by the API route), not just a storage path — same choice
--   already made for doctor_profiles.profile_photo_url in 0034, so nei-
--   ther the view nor the page needs a second call to resolve a URL.
-- - "Pending" is not a state here on purpose: an ad simply IS active or
--   paused, and whether it's currently showing is entirely a function of
--   today's date against starts_at/ends_at — no separate admin approval
--   step is needed since the admin is the one creating it.

create table if not exists public.sponsored_ads (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null,
  image_path text not null,
  image_url text not null,
  click_url text,
  starts_at date not null,
  ends_at date not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  check (ends_at >= starts_at)
);

alter table public.sponsored_ads enable row level security;

drop policy if exists "Admins can view all sponsored ads" on public.sponsored_ads;
create policy "Admins can view all sponsored ads"
  on public.sponsored_ads for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can create sponsored ads" on public.sponsored_ads;
create policy "Admins can create sponsored ads"
  on public.sponsored_ads for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update sponsored ads" on public.sponsored_ads;
create policy "Admins can update sponsored ads"
  on public.sponsored_ads for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete sponsored ads" on public.sponsored_ads;
create policy "Admins can delete sponsored ads"
  on public.sponsored_ads for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Public storage bucket for ad creatives — deliberately public, same
-- reasoning as doctor-photos (0034): the image must be viewable on the
-- public home page with no login, but is still only ever WRITTEN by a
-- service-role API route (zero storage policies, same as every bucket
-- in this app — a doctor/patient/anon session can never write here
-- directly no matter what).
insert into storage.buckets (id, name, public)
values ('sponsored-ads', 'sponsored-ads', true)
on conflict (id) do nothing;

-- The one thing the public site actually reads: today's live, active
-- sponsored ad(s), and nothing else about the sponsored_ads table (not
-- its history, not a paused ad, not a future-dated one that hasn't
-- started yet, not who created it). Security-definer view, same
-- mechanism as public_doctor_directory (0028).
create or replace view public.active_sponsored_ads as
select
  id,
  sponsor_name,
  image_url,
  click_url
from public.sponsored_ads
where status = 'active'
  and current_date between starts_at and ends_at;

grant select on public.active_sponsored_ads to anon, authenticated;
