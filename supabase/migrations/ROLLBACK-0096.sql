-- Undo 0096 (paid + verified locator listings). WARNING: deletes every workplace application
-- (source 'owner'), every therapy place, all listing payments / receipts, per-place counters,
-- reports and the fee table. Export them first if you want to keep them.
-- AFTER running this file, re-run 0095_locator.sql (it is safe to repeat): it puts back the
-- original search / counts / event / summary functions.
drop function if exists public.locator_admin_place_stats(uuid);
drop function if exists public.locator_admin_purge_drafts();
drop function if exists public.locator_admin_verify(uuid, text, text, text);
drop function if exists public.locator_admin_make_link(uuid);
drop function if exists public.locator_admin_record_payment(uuid, int, text, text, text, int);
drop function if exists public.locator_settle_payment(uuid, jsonb);
drop function if exists public.locator_checkout_info(text);
drop function if exists public.locator_manage_view(text);
drop function if exists public.locator_attach_proof(uuid, text, text);
drop function if exists public.locator_apply_place(text, text, text, text, text, text, text, double precision, double precision, text, text, text, text, boolean, text, boolean);
drop function if exists public.locator_report(uuid, text, text);
drop function if exists public.locator_directions_target(uuid);
drop function if exists public.locator_search_note(text, text, boolean);
drop function if exists public.locator_place_event(uuid, text);
drop function if exists public.locator_places_shown(uuid[]);
drop function if exists public.locator_fee_list();
drop function if exists public.locator_code_check(text, text);
drop function if exists public.locator_code_issue(text, text);
drop function if exists public.locator_search(double precision, double precision, numeric, text, text);
drop function if exists public.locator_admin_summary();
drop function if exists public.locator_counts();

drop table if exists public.locator_phone_codes;
drop table if exists public.locator_reports;
drop table if exists public.locator_search_areas_daily;
drop table if exists public.locator_place_events_daily;
drop table if exists public.locator_payments;
drop table if exists public.locator_fees;
drop sequence if exists public.locator_receipt_seq;

delete from public.locator_events_daily where category = 'therapy' or event in ('apply', 'pay_start', 'paid', 'report');
delete from public.locator_places where category = 'therapy' or source = 'owner' or kind in ('rehab', 'autism_therapy', 'physio', 'speech', 'occupational', 'psychology');

alter table public.locator_places
  drop column if exists owner_name, drop column if exists owner_phone, drop column if exists owner_email,
  drop column if exists phone_verified, drop column if exists verification_status,
  drop column if exists verification_notes, drop column if exists rejection_reason,
  drop column if exists registration_numbers, drop column if exists proof_paths,
  drop column if exists manage_token_hash, drop column if exists paid_until, drop column if exists featured_until;

alter table public.locator_places drop constraint if exists locator_places_category_check;
alter table public.locator_places add constraint locator_places_category_check check (category in ('doctor', 'autism'));
alter table public.locator_places drop constraint if exists locator_places_kind_check;
alter table public.locator_places add constraint locator_places_kind_check check (kind in (
  'clinic', 'doctor', 'hospital', 'lab', 'pharmacy', 'therapy',
  'school', 'barber', 'salon', 'restaurant', 'cafe', 'market', 'park', 'mall', 'other'));
alter table public.locator_places drop constraint if exists locator_places_source_check;
alter table public.locator_places add constraint locator_places_source_check check (source in ('admin', 'public'));
alter table public.locator_events_daily drop constraint if exists locator_events_daily_category_check;
alter table public.locator_events_daily add constraint locator_events_daily_category_check check (category in ('doctor', 'autism', 'none'));
alter table public.locator_events_daily drop constraint if exists locator_events_daily_event_check;
alter table public.locator_events_daily add constraint locator_events_daily_event_check check (event in (
  'search', 'results', 'empty', 'directions_tap', 'call_tap', 'book_tap', 'gps_denied', 'coming_soon', 'waitlist', 'suggest'));
