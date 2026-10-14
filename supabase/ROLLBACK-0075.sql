-- Undo 0075 (does not bring back doctors already deleted).
drop function if exists public.admin_delete_doctor(uuid);
drop table if exists public.doctor_deletion_log;
