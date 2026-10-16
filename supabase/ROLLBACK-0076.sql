-- Undo 0076. Doctors keep whatever access they already have; only the
-- Safepay-checkout bookkeeping is removed. (Payment history in
-- doctor_access_payments is deleted - export it first if you want it.)
drop function if exists public.settle_doctor_access_payment(uuid, jsonb);
drop table if exists public.doctor_access_payments;
alter table public.doctor_profiles drop column if exists use_safepay_checkout;
