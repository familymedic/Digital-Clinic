-- 0079: doctors no longer see patients' mobile numbers; the clinic (admin)
-- keeps each doctor's mobile number instead, for the planned bulk-message system.
--
-- Safe to run more than once. Nothing patients or doctors currently use is removed.
--
--   1. doctor_profiles.phone - the doctor's own mobile number, digits only with the
--      country code (e.g. 923001234567). Who can read it:
--        * the doctor (existing "view own profile" policy),
--        * admins (existing "view all doctor profiles" policy),
--        * NOT patients or visitors: the public doctor directory is a view
--          (public_doctor_directory) that lists its columns explicitly, and this
--          column is not in it.
--      Doctors cannot change it with a direct database write (there is no doctor
--      UPDATE policy on this table); they save it through /api/doctors/contact.
--
--   2. consultation_patient_phone() is removed. It was the function that let a
--      doctor read the patient's mobile number on their own consultation. If you
--      already ran the earlier version of 0077, this removes it; if not, this is
--      a no-op. The patient's number stays in the patient's account and in
--      guest_access (service-role only), so the admin side can still use it later.

alter table public.doctor_profiles add column if not exists phone text;

drop function if exists public.consultation_patient_phone(uuid);
