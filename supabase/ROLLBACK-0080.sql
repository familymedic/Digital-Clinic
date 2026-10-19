-- Rolls back 0080_doctor_ratings.sql. Existing reviews stay in patient_feedback;
-- they just stop being public.
drop view if exists public.public_doctor_reviews;
drop view if exists public.doctor_rating_summary;
drop trigger if exists patient_feedback_before_insert on public.patient_feedback;
drop function if exists public.patient_feedback_before_insert();
alter table public.patient_feedback drop constraint if exists patient_feedback_comment_status_check;
alter table public.patient_feedback drop column if exists comment_status;
alter table public.patient_feedback drop column if exists rating_hidden;
