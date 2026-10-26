-- ROLLBACK for 0089_family_packages_use.sql.
-- Run ROLLBACK-0091 and ROLLBACK-0090 first if those were applied.
-- 1. Puts the three original booking-rule functions back, word for word
--    (0032 text hours, 0033 daily patient cap, 0062 text off-days).
-- 2. Drops the stage-2 pack functions. Pack purchases and claims already
--    recorded by 0088 tables are left alone (ROLLBACK-0088 removes those).
-- Existing consultations that were started from a pack stay as normal
-- consultations; only their link to the pack (the claim) remains in 0088 tables.

drop function if exists public.admin_package_activity();
drop function if exists public.admin_package_return_credit(uuid, text);
drop function if exists public.admin_package_grant(uuid, text, text, int, boolean, text);
drop function if exists public.doctor_package_invite_list();
drop function if exists public.doctor_package_my_state();
drop function if exists public.package_my_purchases();
drop function if exists public.package_start_consultation(uuid, uuid, text, text, uuid);
drop function if exists public.package_mode_used(uuid, text);

create or replace function public.enforce_text_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start time;
  v_end time;
  v_limit int;
  v_now_pkt timestamp;
  v_today_count int;
  v_has_row boolean;
begin
  if new.delivery_mode <> 'text' then
    return new;
  end if;

  select dta.start_time, dta.end_time, dta.daily_limit
    into v_start, v_end, v_limit
  from public.doctor_text_availability dta
  where dta.doctor_id = new.doctor_id
  for update;

  v_has_row := found;
  v_now_pkt := (now() at time zone 'Asia/Karachi');

  if not v_has_row then
    -- No doctor-specific window — the platform's own standard hours
    -- apply (8:00 AM-11:00 PM Pakistan time), with no daily cap.
    v_start := time '08:00';
    v_end := time '23:00';
  end if;

  if not (v_now_pkt::time >= v_start and v_now_pkt::time < v_end) then
    raise exception
      'This doctor is only available for text consultations between % and % (Pakistan time). Please try again during those hours, choose audio/video, or pick a different doctor.',
      to_char(v_start, 'HH12:MI AM'), to_char(v_end, 'HH12:MI AM');
  end if;

  if v_has_row then
    select count(*) into v_today_count
    from public.consultations c
    where c.doctor_id = new.doctor_id
      and c.delivery_mode = 'text'
      and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

    if v_today_count >= v_limit then
      raise exception
        'This doctor has reached their text consultation limit for today. Please try again tomorrow, choose audio/video, or pick a different doctor.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_daily_patient_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_now_pkt timestamp;
  v_today_count int;
begin
  select daily_patient_cap into v_cap
  from public.doctor_profiles
  where id = new.doctor_id
  for update;

  if v_cap is null then
    -- No doctor_profiles row for this doctor_id at all — shouldn't be
    -- reachable (assign_default_doctor already validates doctor_id
    -- against a live doctor_profiles row before this trigger runs),
    -- but fail open rather than block on a state that can't sensibly
    -- be capped.
    return new;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = new.doctor_id
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  if v_today_count >= v_cap then
    raise exception
      'This doctor has reached their maximum of % patients for today across all consultation types. Please try again tomorrow or choose a different doctor.',
      v_cap;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_text_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delivery_mode = 'text'
     and new.doctor_id is not null
     and public.text_is_switched_off(new.doctor_id, (now() at time zone 'Asia/Karachi')) then
    raise exception
      'This doctor is not taking text consultations today. Please try another day, choose audio/video, or pick a different doctor.';
  end if;
  return new;
end;
$$;
