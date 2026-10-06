-- Text-consultation on/off switch and weekday-off days (2026-10-05,
-- physician: "there is no switch off button for the Text consultations.
-- if I'm not available on Sundays I can't turn it off").
--
-- Until now a doctor's text availability was one daily window (8 AM-11 PM
-- by default) that applied EVERY day, with no way to say "not today" -
-- the only control was narrowing the hours. This adds, on the doctor's
-- existing text-availability row:
--   text_enabled  master switch (false = no new text consultations at all)
--   days_off      ISO weekdays text is OFF on (1 = Monday ... 7 = Sunday),
--                 evaluated in Pakistan time like the rest of the feature
-- Everything else (hours, daily limit, platform 8 AM-11 PM bounds) is
-- unchanged.
--
-- A doctor with no row at all still gets the platform default (on, every
-- day, 8 AM-11 PM, no limit). Turning text off from the UI creates a row
-- for them, which is why daily_limit must now be allowed to be NULL
-- ("no daily limit") - otherwise switching text off would silently also
-- impose a limit. NULL is already treated as "no cap" by the existing
-- enforcement (a comparison with NULL is never true).
--
-- Enforcement design: the new rule lives in its OWN small trigger rather
-- than editing the existing text-hours trigger, so it can't clash with
-- or revert anything in that older function. The patient-facing status
-- function IS replaced (same name, same columns, so the booking page and
-- the "available now" filter keep working unchanged): on an off day it
-- reports closed with no hours, which the booking page already renders as
-- "Not available for text right now" and the filter treats as not
-- available for text.

-- 1. Columns.
alter table public.doctor_text_availability
  add column if not exists text_enabled boolean not null default true,
  add column if not exists days_off smallint[] not null default '{}';

alter table public.doctor_text_availability
  drop constraint if exists doctor_text_availability_days_off_check;
alter table public.doctor_text_availability
  add constraint doctor_text_availability_days_off_check
  check (days_off <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);

alter table public.doctor_text_availability
  alter column daily_limit drop not null;

-- 2. "Is text switched off for this doctor at this Pakistan-time moment?"
create or replace function public.text_is_switched_off(p_doctor_id uuid, p_now_pkt timestamp)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (not dta.text_enabled)
            or (extract(isodow from p_now_pkt)::smallint = any (dta.days_off))
     from public.doctor_text_availability dta
     where dta.doctor_id = p_doctor_id),
    false
  );
$$;

-- 3. Enforcement: refuse a NEW text consultation on a switched-off day.
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

drop trigger if exists on_consultation_enforce_text_switch on public.consultations;
create trigger on_consultation_enforce_text_switch
  before insert on public.consultations
  for each row execute function public.enforce_text_switch();

-- 4. Patient-facing status (replaces 0032's version; same signature).
--    Adds: the off-day/off-switch case, and a NULL daily limit meaning
--    "no cap" (remaining = NULL).
create or replace function public.text_availability_status(p_doctor_id uuid)
returns table (
  configured boolean,
  is_open boolean,
  remaining int,
  start_time time,
  end_time time
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start time;
  v_end time;
  v_limit int;
  v_enabled boolean;
  v_days_off smallint[];
  v_now_pkt timestamp;
  v_today_count int;
  v_has_row boolean;
begin
  select dta.start_time, dta.end_time, dta.daily_limit, dta.text_enabled, dta.days_off
    into v_start, v_end, v_limit, v_enabled, v_days_off
  from public.doctor_text_availability dta
  where dta.doctor_id = p_doctor_id;

  v_has_row := found;
  v_now_pkt := (now() at time zone 'Asia/Karachi');

  if not v_has_row then
    v_start := time '08:00';
    v_end := time '23:00';
    return query select
      false,
      (v_now_pkt::time >= v_start and v_now_pkt::time < v_end),
      null::int,
      v_start,
      v_end;
    return;
  end if;

  -- Switched off entirely, or today is one of the doctor's off days.
  if (not v_enabled) or (extract(isodow from v_now_pkt)::smallint = any (v_days_off)) then
    return query select true, false, null::int, null::time, null::time;
    return;
  end if;

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = p_doctor_id
    and c.delivery_mode = 'text'
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  return query select
    true,
    (v_now_pkt::time >= v_start and v_now_pkt::time < v_end
       and (v_limit is null or v_today_count < v_limit)),
    case when v_limit is null then null::int else greatest(v_limit - v_today_count, 0) end,
    v_start,
    v_end;
end;
$$;

grant execute on function public.text_availability_status(uuid) to authenticated, anon;
