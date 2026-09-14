-- Text-consultation capacity (2026-09-14): the physician flagged a real
-- gap — video/audio bookings are bounded by the doctor's own manually-
-- created time slots (0021), but a text consultation has no equivalent
-- limit at all; any number of patients can book text with a doctor at
-- any hour. Confirmed with the physician: NOT discrete slots like
-- video/audio (text is asynchronous, not a scheduled meeting) — instead
-- each doctor declares a single daily TIME WINDOW they're available to
-- respond to text consultations, plus a maximum number of text
-- consultations per day. Same self-service, doctor-owned-row pattern as
-- `doctor_availability_slots` (0021), not an admin-set number.
--
-- Deliberately additive/opt-in, matching this project's standing
-- pattern: a doctor with NO row here keeps today's exact behavior —
-- text bookable any time, no daily cap — until they explicitly set a
-- window. Nothing here changes for an existing doctor unless they
-- configure it.
--
-- Two things stated explicitly rather than left implicit, since they're
-- easy to get wrong silently:
-- 1. "A day" and "the current time" are evaluated in Pakistan Standard
--    Time (Asia/Karachi, UTC+5, no DST) — the actual business's own
--    timezone — not the server's or a patient's browser timezone.
-- 2. A window that crosses midnight (e.g. 10pm-2am) is NOT supported in
--    this first version — `end_time` must be later than `start_time` in
--    the same day. Flagged here as a known simplification, not an
--    oversight; a doctor wanting overnight text availability needs a
--    follow-up change, not silently wrong behavior.

create table if not exists public.doctor_text_availability (
  doctor_id uuid primary key references auth.users (id) on delete cascade,
  start_time time not null,
  end_time time not null,
  daily_limit int not null check (daily_limit > 0),
  updated_at timestamptz not null default now(),
  constraint doctor_text_availability_window_check check (end_time > start_time)
);

alter table public.doctor_text_availability enable row level security;

-- Same ownership pattern as doctor_availability_slots (0021): a doctor
-- manages only their own row, full CRUD, no patient- or admin-facing
-- policy at all (patients learn only the derived open/closed + spots
-- remaining, via the function below — never the raw row).
drop policy if exists "Doctors can view their own text availability" on public.doctor_text_availability;
create policy "Doctors can view their own text availability"
  on public.doctor_text_availability for select
  using (doctor_id = auth.uid());

drop policy if exists "Doctors can set their own text availability" on public.doctor_text_availability;
create policy "Doctors can set their own text availability"
  on public.doctor_text_availability for insert
  with check (doctor_id = auth.uid());

drop policy if exists "Doctors can update their own text availability" on public.doctor_text_availability;
create policy "Doctors can update their own text availability"
  on public.doctor_text_availability for update
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid());

drop policy if exists "Doctors can delete their own text availability" on public.doctor_text_availability;
create policy "Doctors can delete their own text availability"
  on public.doctor_text_availability for delete
  using (doctor_id = auth.uid());

-- Patient-facing status check, same shape/intent as list_open_slots()
-- (0021): returns only what's needed to decide whether to offer the
-- text option right now, never anything else about the doctor's row.
-- security definer + a stable, safe search_path, same reasoning as
-- list_open_slots (needs to read a table with no patient-facing SELECT
-- policy, and count consultations across the RLS boundary).
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
begin
  select dta.start_time, dta.end_time, dta.daily_limit
    into v_start, v_end, v_limit
  from public.doctor_text_availability dta
  where dta.doctor_id = p_doctor_id;

  if not found then
    -- No window configured — unrestricted, exactly like before this
    -- feature existed.
    return query select false, true, null::int, null::time, null::time;
    return;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

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

grant execute on function public.text_availability_status(uuid) to authenticated, anon;

-- Authoritative enforcement — never trust the client, same principle as
-- every other booking/payment gate in this app. Runs only for
-- delivery_mode = 'text'; audio/video are untouched (already gated by
-- enforce_slot_capacity, 0021). Named to sort after
-- "on_consultation_assign_doctor" (0015/0028) alphabetically, so
-- NEW.doctor_id is already set by the time this runs.
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
begin
  if new.delivery_mode <> 'text' then
    return new;
  end if;

  -- Lock the doctor's own availability row for the rest of this
  -- transaction, same reasoning as enforce_slot_capacity's `for update`
  -- on the slot row: without it, two concurrent text bookings against
  -- the same doctor could both read "under the limit" before either
  -- commits.
  select dta.start_time, dta.end_time, dta.daily_limit
    into v_start, v_end, v_limit
  from public.doctor_text_availability dta
  where dta.doctor_id = new.doctor_id
  for update;

  if not found then
    -- No window configured for this doctor — unrestricted.
    return new;
  end if;

  v_now_pkt := (now() at time zone 'Asia/Karachi');

  if not (v_now_pkt::time >= v_start and v_now_pkt::time < v_end) then
    raise exception
      'This doctor is only available for text consultations between % and % (Pakistan time). Please try again during those hours, choose audio/video, or pick a different doctor.',
      to_char(v_start, 'HH12:MI AM'), to_char(v_end, 'HH12:MI AM');
  end if;

  select count(*) into v_today_count
  from public.consultations c
  where c.doctor_id = new.doctor_id
    and c.delivery_mode = 'text'
    and (c.created_at at time zone 'Asia/Karachi')::date = v_now_pkt::date;

  if v_today_count >= v_limit then
    raise exception
      'This doctor has reached their text consultation limit for today. Please try again tomorrow, choose audio/video, or pick a different doctor.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_consultation_enforce_text_availability on public.consultations;
create trigger on_consultation_enforce_text_availability
  before insert on public.consultations
  for each row execute function public.enforce_text_availability();
