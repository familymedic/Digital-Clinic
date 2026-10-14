-- ROLLBACK for 0074_doctor_view_events.sql: removes the doctor views report and its data.
-- Run only AFTER putting the old code back (or it simply shows nothing). Safe to run twice.
drop function if exists public.admin_doctor_view_stats(timestamptz, timestamptz);
drop table if exists public.doctor_events;
