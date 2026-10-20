-- Rolls back 0081_free_week.sql completely.
-- WARNING: this deletes the free-week records (registrations, claims, doctor
-- opt-ins, report data). The free consultations themselves stay in the
-- consultations table as normal completed/submitted consultations. Look at
-- /admin/free-week first if you want to keep the numbers.
--
-- A free-week time that a doctor published stays as an ordinary slot after
-- this runs (it simply becomes bookable as a paid time again), so remove or
-- keep them from the doctor availability page as you prefer.

drop trigger if exists on_consultation_free_week_slot_guard on public.consultations;
drop function if exists public.free_week_slot_guard();

-- Put list_open_slots back exactly as 0072 defined it.
create or replace function public.list_open_slots()
returns table (
  id uuid,
  doctor_id uuid,
  start_time timestamptz,
  capacity int,
  remaining int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.doctor_id,
    s.start_time,
    s.capacity,
    (s.capacity - count(c.id))::int as remaining
  from public.doctor_availability_slots s
  left join public.consultations c on c.slot_id = s.id
    and public.consultation_holds_slot(c.status, c.created_at, c.slot_hold_until)
  where s.start_time > now()
  group by s.id, s.doctor_id, s.start_time, s.capacity
  having s.capacity - count(c.id) > 0
  order by s.start_time asc;
$$;

drop function if exists public.admin_free_week_families();
drop function if exists public.admin_free_week_report();
drop function if exists public.admin_free_week_save(text, date, date, date, boolean, int, int, int, int);
drop function if exists public.admin_free_week_get();
drop function if exists public.free_week_consume_discount(uuid);
drop function if exists public.free_week_apply_discount(uuid, uuid, int);
drop function if exists public.free_week_my_discount();
drop function if exists public.free_week_discount_available(uuid);
drop function if exists public.free_week_claim(uuid, uuid, text, text, uuid);
drop function if exists public.free_week_enrol(text, boolean);
drop function if exists public.free_week_remove_slot(uuid);
drop function if exists public.free_week_my_slots();
drop function if exists public.free_week_add_slots(date, time, time, int);
drop function if exists public.free_week_set_optin(boolean, int, boolean);
drop function if exists public.free_week_my_state();
drop function if exists public.free_week_open_slots();
drop function if exists public.free_week_doctors_list();
drop function if exists public.free_week_status();
drop function if exists public.free_week_credits_used(uuid, uuid);
drop function if exists public.free_week_is_guest(uuid);
drop function if exists public.free_week_phase(public.free_week_campaigns);
drop function if exists public.free_week_pick();

drop table if exists public.free_week_discount_uses;
drop table if exists public.free_week_claims;
drop table if exists public.free_week_members;
drop table if exists public.free_week_slots;
drop table if exists public.free_week_doctors;
drop table if exists public.free_week_campaigns;
drop function if exists public.free_week_norm_phone(text);
