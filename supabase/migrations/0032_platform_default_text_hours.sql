-- Text-consultation capacity, follow-up (2026-09-15): clarified with the
-- physician that 8:00 AM-11:00 PM (Pakistan time) should be the
-- platform's own default text-availability window, applied
-- automatically to every doctor — not merely a suggested starting
-- value a doctor can opt into. Confirmed scope: text only (video/audio
-- slots stay entirely doctor-controlled, unchanged); a doctor can still
-- narrow their own hours within that window (e.g. 10 AM-6 PM), but a
-- configured window can no longer extend past the platform's own
-- standard hours. No change to the daily-count cap side of this
-- feature — a doctor with no row configured still has no daily limit,
-- only a bounded window; 0031's cap mechanism is untouched.
--
-- This replaces 0031's "no row = fully unrestricted (any time, no
-- limit)" default with "no row = the platform's standard hours apply,
-- still no daily limit" — the one behavior change this migration makes
-- to every doctor who hasn't explicitly configured their own window.

-- 1. Clamp any already-configured window into the platform's bounds
--    before the stricter CHECK below can enforce it going forward —
--    same "normalize existing data before tightening a constraint"
--    pattern as every other constraint-tightening migration in this
--    project. In practice this table is brand new (0031) and very
--    unlikely to have any out-of-bounds row yet, but this makes the
--    migration correct regardless of what's already been configured by
--    the time it runs.
update public.doctor_text_availability
set
  start_time = greatest(start_time, time '08:00'),
  end_time = least(end_time, time '23:00')
where start_time < time '08:00' or end_time > time '23:00';

alter table public.doctor_text_availability
  drop constraint if exists doctor_text_availability_window_check;

alter table public.doctor_text_availability
  add constraint doctor_text_availability_window_check
  check (end_time > start_time and start_time >= time '08:00' and end_time <= time '23:00');

-- 2. The enforcement trigger (0031): a doctor with no row configured
--    now checks against the platform's own 8:00 AM-11:00 PM window
--    instead of skipping the check entirely — still no daily-count
--    cap in that case, since the physician's ask here was specifically
--    about closing the service overnight, not about volume.
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

-- 3. The patient-facing status function (0031): same default-window
--    logic, still reporting `configured = false` for a doctor who
--    hasn't set their own row, so the UI can label it as the
--    platform's standard hours rather than something this doctor chose
--    specifically — but now returning the real (default) window and
--    open/closed state instead of always claiming "open".
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
  v_now_pkt timestamp;
  v_today_count int;
  v_has_row boolean;
begin
  select dta.start_time, dta.end_time, dta.daily_limit
    into v_start, v_end, v_limit
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

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = p_doctor_id
    and c.delivery_mode = 'text'
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  return query select
    true,
    (v_now_pkt::time >= v_start and v_now_pkt::time < v_end and v_today_count < v_limit),
    greatest(v_limit - v_today_count, 0),
    v_start,
    v_end;
end;
$$;
