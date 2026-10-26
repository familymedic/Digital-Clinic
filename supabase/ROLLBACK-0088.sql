-- ROLLBACK for 0088_family_packages_core.sql.
-- Run ROLLBACK-0091, ROLLBACK-0090 and ROLLBACK-0089 FIRST if those were applied.
-- WARNING: this deletes every package, request, invite, purchase and claim.
-- Nothing outside the family-package tables is touched.

drop function if exists public.doctor_package_invite_remove(uuid);
drop function if exists public.doctor_package_invite_add(text);
drop function if exists public.doctor_package_ref_code();
drop function if exists public.doctor_package_set_paused(boolean);
drop function if exists public.doctor_package_withdraw_request();
drop function if exists public.doctor_package_request(jsonb);
drop function if exists public.admin_package_decide_request(uuid, boolean, jsonb, text);
drop function if exists public.admin_package_set_status(uuid, text);
drop function if exists public.admin_package_save(jsonb);
drop function if exists public.admin_package_overview();
drop function if exists public.admin_package_set_sales(boolean);
drop function if exists public.package_record_ref(text);
drop function if exists public.package_public_for_doctor(uuid);
drop function if exists public.package_active_families(uuid);
drop function if exists public.package_credits_left(uuid);
drop function if exists public.package_credits_used(uuid);

drop table if exists public.family_package_claims;
drop table if exists public.family_package_members;
drop table if exists public.family_package_purchases;
drop table if exists public.family_package_referrals;
drop table if exists public.family_package_ref_codes;
drop table if exists public.family_package_invites;
drop table if exists public.family_package_requests;
drop table if exists public.family_packages;
drop table if exists public.family_package_settings;

drop function if exists public.package_int(jsonb, text, int, int, text, int);
drop function if exists public.package_is_guest(uuid);
drop function if exists public.package_is_admin();
drop function if exists public.package_norm_phone(text);
