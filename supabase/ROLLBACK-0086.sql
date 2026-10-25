-- Rollback for 0086 (admin doctor inactivity flags). Read-only feature: just drop the function.
drop function if exists public.admin_doctor_activity();
