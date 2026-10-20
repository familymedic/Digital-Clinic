-- Rollback for 0082 (home-page pop-up). Removes the pop-up feature's database
-- objects only. The shared "sponsored-ads" storage bucket is left in place
-- (sponsor ads use it). Uploaded pop-up images stay in that bucket; delete
-- them from Supabase Storage > sponsored-ads if you want them gone.
drop view if exists public.active_site_popups;
drop table if exists public.site_popups;
