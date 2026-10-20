-- 0082: home-page pop-up announcement (2026-10-20).
--
-- Zayn wants a flyer (first use: the free-week pre-registration) to appear as
-- a pop-up when the home page opens, with a close (X) button, uploaded and
-- scheduled from Admin. The existing sponsor strip is a thin cropped banner
-- and is left alone (it only gets a display tweak in code).
--
-- Deliberately a NEW small table, copied from the sponsored_ads pattern
-- (0035), so nothing existing is rewritten and it can be removed cleanly
-- (see ROLLBACK-0082.sql):
-- - Admin-only writes (RLS against admin_profiles).
-- - The raw table is never readable by the public; the public site reads the
--   narrow view active_site_popups, which only returns pop-ups that are
--   'active' AND whose dates include today in Pakistan time.
-- - Images reuse the existing public "sponsored-ads" bucket (only a
--   service-role API route ever writes to it). The bucket is created here
--   only if it does not exist yet.
-- Safe to run more than once.

create table if not exists public.site_popups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_path text not null,
  image_url text not null,
  click_url text,
  button_label text not null default 'Register free',
  starts_at date not null,
  ends_at date not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  check (ends_at >= starts_at),
  check (char_length(title) between 1 and 120),
  check (char_length(button_label) between 1 and 40),
  check (click_url is null or click_url ~ '^(https?://|/[^/])')
);

alter table public.site_popups enable row level security;

drop policy if exists "Admins can view all site popups" on public.site_popups;
create policy "Admins can view all site popups"
  on public.site_popups for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can create site popups" on public.site_popups;
create policy "Admins can create site popups"
  on public.site_popups for insert
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update site popups" on public.site_popups;
create policy "Admins can update site popups"
  on public.site_popups for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can delete site popups" on public.site_popups;
create policy "Admins can delete site popups"
  on public.site_popups for delete
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

insert into storage.buckets (id, name, public)
values ('sponsored-ads', 'sponsored-ads', true)
on conflict (id) do nothing;

-- What the public home page reads: only live pop-ups, newest first, and only
-- the columns it needs. "Today" is the Pakistan calendar date so a pop-up set
-- to start on a given day starts at midnight in Pakistan, not 5am.
create or replace view public.active_site_popups as
select
  id,
  image_url,
  click_url,
  button_label,
  created_at
from public.site_popups
where status = 'active'
  and (now() at time zone 'Asia/Karachi')::date between starts_at and ends_at
order by created_at desc;

grant select on public.active_site_popups to anon, authenticated;
