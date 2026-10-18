-- Undo 0079. Removes the saved doctor mobile numbers.
-- (It does NOT bring back the doctor's view of patient numbers: that was removed on purpose.)
alter table public.doctor_profiles drop column if exists phone;
