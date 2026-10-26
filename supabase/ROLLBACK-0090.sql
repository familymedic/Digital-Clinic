-- ROLLBACK for 0090_family_packages_purchase.sql.
-- Run ROLLBACK-0091 first if it was applied.
-- Drops the purchase / settle / payout / refund functions. Purchases already
-- recorded stay in the 0088 tables (ROLLBACK-0088 removes those).
-- If a family has a pending checkout open when this runs, their payment can no
-- longer be turned into a live pack automatically; settle it by hand with
-- admin_package_grant (0089) if you keep 0089.

drop function if exists public.admin_package_refund(uuid, int, text);
drop function if exists public.admin_package_refund_suggestion(uuid);
drop function if exists public.admin_package_mark_paid(uuid, int, text);
drop function if exists public.admin_package_payouts();
drop function if exists public.admin_package_set_source(uuid, text, text);
drop function if exists public.settle_package_purchase(uuid, jsonb);
drop function if exists public.package_cancel_pending(uuid);
drop function if exists public.package_set_tracker(uuid, text);
drop function if exists public.package_begin_purchase(uuid, uuid, text);
drop function if exists public.package_attribution(uuid, uuid);
