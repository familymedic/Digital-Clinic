-- "Who is available" filter for the public doctors page (2026-10-04,
-- physician: "patients should have a filter on which doctor is
-- available right now ... matching the patient's urgency ... sorted by
-- available on text, video or audio ... without disturbing the entire
-- code").
--
-- Deliberately ADDITIVE and READ-ONLY: this creates exactly one new
-- function and changes nothing that already exists — no table, column,
-- policy, trigger, view or existing function is touched. It does not
-- re-implement any availability rule; it only ASKS the three existing
-- sources of truth and puts the answers side by side, so it can never
-- drift out of sync with what the booking triggers actually enforce:
--   - text_availability_status(doctor)  (0031/0032): is the doctor's
--     daily text window open right now, and are any daily text spots
--     left?
--   - list_open_slots()                 (0021): upcoming audio/video
--     slots that still have capacity.
--   - doctor_daily_capacity(doctor)     (0033): has this doctor already
--     hit their 100-per-day (or admin-set) ceiling today?
--
-- "Available" here means "open according to the doctor's own published
-- hours and slots" — NOT "online this second". There is no live-presence
-- tracking anywhere in this app; that was offered and not chosen.
--
-- Audio and video share ONE pool of slots (0021: a slot is a block of
-- the doctor's time, not tied to a call technology), so this reports
-- them together as "calls". Separating them would need a new per-doctor
-- column and UI — also offered, also not chosen.
--
-- Only returns doctors already visible in public_doctor_directory
-- (approved + active + fee-approved), the exact set the public page
-- already lists. Exposes nothing new about patients: slot start times
-- and remaining spot counts are the same facts list_open_slots() already
-- gives any logged-in patient; this just also makes them readable by a
-- visitor browsing the public page before logging in.
--
-- All "today" / "now" logic is Pakistan Standard Time (Asia/Karachi),
-- the same definition 0031/0033 already use.

create or replace function public.list_available_doctors()
returns table (
  doctor_id uuid,
  -- true once this doctor has reached their daily patient ceiling
  -- (0033); the booking trigger would reject any new booking today.
  daily_full boolean,
  -- Text consultations (0031/0032).
  text_open_now boolean,
  -- Minutes until today's text window opens, only when it is still
  -- ahead of us later today (null when open now, closed for the day,
  -- or the daily text limit is already reached).
  text_opens_in_minutes int,
  -- Daily text spots left; null means this doctor has no daily limit.
  text_spots_left int,
  -- Audio/video (0021): the soonest open slot and how soon it is.
  next_call_start timestamptz,
  next_call_minutes int,
  next_call_spots int,
  -- Open audio/video slots later today (Pakistan date) and in the next
  -- 7 days.
  call_slots_today int,
  call_slots_week int
)
language sql
stable
security definer
set search_path = public
as $$
  with open_slots as (
    select * from public.list_open_slots()
  ),
  n as (
    select (now() at time zone 'Asia/Karachi') as pkt
  )
  select
    d.id as doctor_id,
    coalesce(cap.is_full, false) as daily_full,
    coalesce(tx.is_open, false) as text_open_now,
    case
      when tx.is_open is not true
        and tx.start_time is not null
        and n.pkt::time < tx.start_time
        and coalesce(tx.remaining, 1) > 0
      then ceil(extract(epoch from (tx.start_time - n.pkt::time)) / 60)::int
      else null
    end as text_opens_in_minutes,
    tx.remaining as text_spots_left,
    sl.next_start as next_call_start,
    case
      when sl.next_start is not null
      then greatest(ceil(extract(epoch from (sl.next_start - now())) / 60)::int, 0)
      else null
    end as next_call_minutes,
    nxt.remaining as next_call_spots,
    coalesce(sl.today_cnt, 0) as call_slots_today,
    coalesce(sl.week_cnt, 0) as call_slots_week
  from public.public_doctor_directory d
  cross join n
  left join lateral public.text_availability_status(d.id) tx on true
  left join lateral public.doctor_daily_capacity(d.id) cap on true
  left join lateral (
    select
      min(s.start_time) as next_start,
      (count(*) filter (
        where (s.start_time at time zone 'Asia/Karachi')::date = n.pkt::date
      ))::int as today_cnt,
      (count(*) filter (
        where s.start_time < now() + interval '7 days'
      ))::int as week_cnt
    from open_slots s
    where s.doctor_id = d.id
  ) sl on true
  left join lateral (
    select s.remaining
    from open_slots s
    where s.doctor_id = d.id
    order by s.start_time asc
    limit 1
  ) nxt on true;
$$;

-- Same exposure model as text_availability_status() and
-- doctor_daily_capacity(), which both already allow anon: the public
-- doctors page is visible without logging in.
grant execute on function public.list_available_doctors() to anon, authenticated;
