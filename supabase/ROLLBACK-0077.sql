-- Undo 0077. Patients' bookings, payments and consultations are untouched.
-- Only the quick-booking bookkeeping is removed (saved PINs are lost, so
-- turn NEXT_PUBLIC_QUICK_BOOKING off first).
drop function if exists public.consultation_patient_phone(uuid);
drop function if exists public.guest_last_appointment_end(uuid);
drop function if exists public.access_throttle_clear(text);
drop function if exists public.access_throttle_fail(text, int, int, int);
drop function if exists public.access_throttle_locked(text);
drop function if exists public.access_throttle_hit(text, int, int);
drop table if exists public.access_throttle;
drop table if exists public.guest_access;
revoke execute on function public.list_open_slots() from anon;
