-- 0077: simpler booking for people who are not logged in ("quick booking"),
-- plus a safe way back to their appointment (saved link, or mobile number + PIN).
--
-- Nothing existing is changed or removed. The new booking flow itself stays
-- OFF until NEXT_PUBLIC_QUICK_BOOKING=true is set in Vercel and redeployed,
-- so running this script on its own changes nothing a patient can see.
--
-- What this adds:
--   1. list_open_slots() can now be read by a visitor who is not logged in,
--      so a doctor's times can be shown BEFORE asking the patient anything.
--      (It only returns what the public doctor pages already show: which
--      doctor, what time, how many places are left. Any registered user could
--      already call it.)
--   2. guest_access           - one row per quick-booking account: the
--      normalised mobile number and the patient's own PIN (stored hashed).
--      Service-role only; the browser can never read it.
--   3. access_throttle + access_throttle_*() - a tiny rate-limit / lockout
--      store, used to stop bots creating accounts and to lock out PIN guessing.
--      Service-role only.
--   4. guest_last_appointment_end() - when a guest's most recent appointment
--      ends. The 3-day access window counts from this, NOT from account
--      creation, so someone booked a week ahead is never cut off early.
--   5. consultation_patient_phone() - lets a doctor see the mobile number of
--      the patient on THEIR OWN consultation (nobody else can).
--
-- It does NOT touch the 15-day guest clean-up job. Patient access ends 3 days
-- after the last appointment (enforced by the app); records are kept as before.

-- 1. Visitors who are not logged in can see open times.
grant execute on function public.list_open_slots() to anon;

-- 2. Mobile number + PIN for quick-booking accounts.
create table if not exists public.guest_access (
  account_id uuid primary key references auth.users (id) on delete cascade,
  phone_norm text not null,
  pin_hash text,
  pin_set_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists guest_access_phone_idx on public.guest_access (phone_norm);

alter table public.guest_access enable row level security;
-- No policies on purpose: only the server (service role) reads or writes this.
revoke all on public.guest_access from anon, authenticated;
grant all on public.guest_access to service_role;

-- 3. Rate limits and lockouts.
create table if not exists public.access_throttle (
  key text primary key,
  fail_count int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.access_throttle enable row level security;
revoke all on public.access_throttle from anon, authenticated;
grant all on public.access_throttle to service_role;

-- Counts one attempt for this key. Returns true while the key is still under
-- its limit for the current window, false once it is over.
create or replace function public.access_throttle_hit(p_key text, p_max int, p_window_secs int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.access_throttle as t (key, fail_count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set fail_count = case
          when t.window_start < now() - make_interval(secs => p_window_secs) then 1
          else t.fail_count + 1
        end,
        window_start = case
          when t.window_start < now() - make_interval(secs => p_window_secs) then now()
          else t.window_start
        end
  returning t.fail_count into v_count;
  return v_count <= p_max;
end;
$$;

-- Seconds left on a lockout for this key (0 when not locked).
create or replace function public.access_throttle_locked(p_key text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select greatest(0, ceil(extract(epoch from (t.locked_until - now())))::int)
       from public.access_throttle t
      where t.key = p_key and t.locked_until is not null and t.locked_until > now()),
    0
  );
$$;

-- Records one FAILED attempt; locks the key once it reaches p_max failures
-- inside the window. (Keep p_lock_secs >= p_window_secs.)
create or replace function public.access_throttle_fail(p_key text, p_max int, p_window_secs int, p_lock_secs int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.access_throttle as t (key, fail_count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set fail_count = case
          when t.window_start < now() - make_interval(secs => p_window_secs) then 1
          else t.fail_count + 1
        end,
        window_start = case
          when t.window_start < now() - make_interval(secs => p_window_secs) then now()
          else t.window_start
        end
  returning t.fail_count into v_count;

  if v_count >= p_max then
    update public.access_throttle
       set locked_until = now() + make_interval(secs => p_lock_secs)
     where key = p_key;
  end if;
end;
$$;

create or replace function public.access_throttle_clear(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.access_throttle where key = p_key;
$$;

revoke all on function public.access_throttle_hit(text, int, int) from public, anon, authenticated;
revoke all on function public.access_throttle_locked(text) from public, anon, authenticated;
revoke all on function public.access_throttle_fail(text, int, int, int) from public, anon, authenticated;
revoke all on function public.access_throttle_clear(text) from public, anon, authenticated;
grant execute on function public.access_throttle_hit(text, int, int) to service_role;
grant execute on function public.access_throttle_locked(text) to service_role;
grant execute on function public.access_throttle_fail(text, int, int, int) to service_role;
grant execute on function public.access_throttle_clear(text) to service_role;

-- 4. When a guest's latest appointment ends (the 3-day window counts from here).
--    A scheduled call counts as ending one hour after its start time; a text
--    consultation counts as open for a day after it was booked. Whichever is
--    later across all of the account's consultations. NULL = no consultations.
create or replace function public.guest_last_appointment_end(p_account_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(greatest(
           c.created_at + interval '1 day',
           coalesce(s.start_time, c.created_at) + interval '1 hour'
         ))
    from public.consultations c
    join public.family_members fm on fm.id = c.patient_id
    left join public.doctor_availability_slots s on s.id = c.slot_id
   where fm.account_id = p_account_id;
$$;

revoke all on function public.guest_last_appointment_end(uuid) from public, anon, authenticated;
grant execute on function public.guest_last_appointment_end(uuid) to service_role;

-- 5. A doctor can see the mobile number of the patient on their own consultation.
create or replace function public.consultation_patient_phone(p_consultation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  select coalesce(nullif(u.raw_user_meta_data ->> 'phone', ''), nullif(u.phone, ''))
    into v_phone
    from public.consultations c
    join public.family_members fm on fm.id = c.patient_id
    join auth.users u on u.id = fm.account_id
   where c.id = p_consultation_id
     and c.doctor_id = auth.uid();
  return v_phone;
end;
$$;

revoke all on function public.consultation_patient_phone(uuid) from public, anon;
grant execute on function public.consultation_patient_phone(uuid) to authenticated;
