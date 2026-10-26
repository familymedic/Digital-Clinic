-- Undo 0092: removes the list function only. Nothing else depends on it
-- (the page hides the Family Pack tab when the function is missing).
drop function if exists public.package_list_offers();
