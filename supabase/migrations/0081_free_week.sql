-- Free consultation week (2026-10-20).
--
-- A time-limited campaign: doctors who choose to take part donate time, and
-- registered families can book a few free TEXT or AUDIO consultations.
--
-- Built the same way as the free follow-up voucher (0041): a free visit is a
-- normal consultation created straight in 'submitted' status by a narrow
-- security-definer function. It has NO payments row, so it can never appear
-- in revenue, refunds or doctor payouts, and it still obeys the doctor's
-- daily patient cap, text window and slot capacity (existing triggers).
--
-- Reversible by design:
--   * Everything here is NEW tables and functions. The only existing objects
--     touched are list_open_slots() (re-created with one extra condition so
--     free-week times never show up in paid booking) and one new guard
--     trigger on consultations. ROLLBACK-0081.sql restores both.
--   * One switch (free_week_campaigns.active) turns the whole campaign off:
--     nothing new can be claimed and doctors/pages stop showing it. Visits
--     already booked still go ahead.
--   * The campaign ends by itself after ends_on (Pakistan date).
--
-- Rules (decided with the physician):
--   * Registered accounts only (walk-in guests cannot claim).
--   * Email + mobile; one family account per mobile number (no SMS code).
--   * 3 free consultations per account (cancelled ones give the credit back).
--   * Text and audio only. Audio uses dedicated free-week slots the doctor
--     publishes; paid slots are untouched.
--   * Doctors opt in themselves, set their own daily free limit, and can
--     withdraw at any time (visits already booked stay).
--   * There is NO discount or any payment change: a free visit is a normal
--     consultation row with no payment, and paid visits are never touched.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------- helpers

-- Same rules as src/lib/phone.ts normalizePhone(): digits only with country
-- code; Pakistani numbers become 92XXXXXXXXXX.
create or replace function public.free_week_norm_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  t text := btrim(coalesce(p, ''));
  had_plus boolean;
  d text;
begin
  if t = '' then
    return null;
  end if;
  had_plus := left(t, 1) = '+';
  d := regexp_replace(t, '\D', '', 'g');
  if left(d, 2) = '00' then
    d := substr(d, 3);
  elsif not had_plus and left(d, 1) = '0' and length(d) = 11 then
    d := '92' || substr(d, 2);
  elsif not had_plus and length(d) = 10 and left(d, 1) = '3' then
    d := '92' || d;
  end if;
  if length(d) < 10 or length(d) > 15 then
    return null;
  end if;
  if left(d, 2) = '92' and length(d) <> 12 then
    return null;
  end if;
  return d;
end;
$$;

-- ---------------------------------------------------------------- tables

create table if not exists public.free_week_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Free Family Consultation Week',
  -- Pakistan calendar dates. Doctors can opt in from the day it is created;
  -- families can register from opens_on; free visits can be booked from
  -- starts_on to ends_on inclusive.
  opens_on date not null,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default false,
  credits_per_account int not null default 3 check (credits_per_account between 1 and 10),
  modes text[] not null default array['text', 'audio']::text[],
  -- Optional overall ceiling on free visits (null = no ceiling).
  overall_cap int check (overall_cap is null or overall_cap > 0),
  created_at timestamptz not null default now(),
  check (opens_on <= starts_on and starts_on <= ends_on),
  check (modes <@ array['text', 'audio']::text[])
);

create table if not exists public.free_week_doctors (
  campaign_id uuid not null references public.free_week_campaigns (id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  opted_in boolean not null default true,
  daily_free_cap int not null default 5 check (daily_free_cap between 1 and 20),
  terms_accepted_at timestamptz,
  opted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (campaign_id, doctor_id)
);

-- A free-week audio time. Deleting the slot removes this row too.
create table if not exists public.free_week_slots (
  slot_id uuid primary key references public.doctor_availability_slots (id) on delete cascade,
  campaign_id uuid not null references public.free_week_campaigns (id) on delete cascade
);

-- A family account that has registered for the week.
create table if not exists public.free_week_members (
  campaign_id uuid not null references public.free_week_campaigns (id) on delete cascade,
  account_id uuid not null references auth.users (id) on delete cascade,
  phone_norm text not null,
  marketing_consent boolean not null default false,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (campaign_id, account_id),
  unique (campaign_id, phone_norm)
);

create table if not exists public.free_week_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.free_week_campaigns (id) on delete cascade,
  account_id uuid not null references auth.users (id) on delete cascade,
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  doctor_id uuid not null,
  delivery_mode text not null,
  created_at timestamptz not null default now()
);
create index if not exists free_week_claims_account_idx on public.free_week_claims (campaign_id, account_id);
create index if not exists free_week_claims_doctor_idx on public.free_week_claims (campaign_id, doctor_id);

-- Read-only access for the people who need it; every write goes through the
-- functions below (no insert/update/delete policies exist for anyone).
alter table public.free_week_campaigns enable row level security;
alter table public.free_week_doctors enable row level security;
alter table public.free_week_slots enable row level security;
alter table public.free_week_members enable row level security;
alter table public.free_week_claims enable row level security;

drop policy if exists "Admins can view free week campaigns" on public.free_week_campaigns;
create policy "Admins can view free week campaigns"
  on public.free_week_campaigns for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Doctors see own free week row" on public.free_week_doctors;
create policy "Doctors see own free week row"
  on public.free_week_doctors for select
  using (doctor_id = auth.uid() or exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can view free week slots" on public.free_week_slots;
create policy "Admins can view free week slots"
  on public.free_week_slots for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Accounts see own free week registration" on public.free_week_members;
create policy "Accounts see own free week registration"
  on public.free_week_members for select
  using (account_id = auth.uid() or exists (select 1 from public.admin_profiles where id = auth.uid()));

-- Doctors can see WHICH of their consultations are free-week visits (no
-- family or phone details are in this table).
drop policy if exists "Free week claims visible to owner doctor admin" on public.free_week_claims;
create policy "Free week claims visible to owner doctor admin"
  on public.free_week_claims for select
  using (
    account_id = auth.uid()
    or doctor_id = auth.uid()
    or exists (select 1 from public.admin_profiles where id = auth.uid())
  );

-- ------------------------------------------------- campaign state helpers

-- The one campaign that is switched on (latest start date wins).
create or replace function public.free_week_pick()
returns public.free_week_campaigns
language sql
stable
security definer
set search_path = public
as $$
  select c.* from public.free_week_campaigns c
  where c.active
  order by c.starts_on desc, c.created_at desc
  limit 1;
$$;

-- 'draft'       before opens_on (doctors may already opt in; patients see nothing)
-- 'preregister' opens_on .. day before starts_on
-- 'open'        starts_on .. ends_on
-- 'ended'       after ends_on
-- 'none'        no campaign switched on
create or replace function public.free_week_phase(c public.free_week_campaigns)
returns text
language plpgsql
stable
as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if c.id is null or not c.active then
    return 'none';
  end if;
  if today < c.opens_on then
    return 'draft';
  elsif today < c.starts_on then
    return 'preregister';
  elsif today <= c.ends_on then
    return 'open';
  end if;
  return 'ended';
end;
$$;

create or replace function public.free_week_is_guest(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(u.raw_user_meta_data ->> 'is_guest', '') = 'true' or u.email like 'guest.%'
       from auth.users u where u.id = p_account),
    false
  ) or exists (
    select 1 from public.family_members fm where fm.account_id = p_account and fm.is_guest
  );
$$;

create or replace function public.free_week_credits_used(p_campaign uuid, p_account uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.free_week_claims fc
  join public.consultations co on co.id = fc.consultation_id
  where fc.campaign_id = p_campaign and fc.account_id = p_account and co.status <> 'cancelled';
$$;

-- ----------------------------------------------- public: campaign status

create or replace function public.free_week_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_member public.free_week_members;
  v_used int := 0;
  v_phone text;
begin
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase in ('none', 'draft') then
    return jsonb_build_object('phase', 'none');
  end if;

  if v_me is not null then
    select * into v_member from public.free_week_members
     where campaign_id = c.id and account_id = v_me;
    v_used := public.free_week_credits_used(c.id, v_me);
    select pp.phone into v_phone from public.patient_profiles pp where pp.id = v_me;
  end if;

  return jsonb_build_object(
    'phase', v_phase,
    'name', c.name,
    'opens_on', c.opens_on,
    'starts_on', c.starts_on,
    'ends_on', c.ends_on,
    'credits_per_account', c.credits_per_account,
    'modes', to_jsonb(c.modes),
    'signed_in', v_me is not null,
    'is_guest', case when v_me is null then false else public.free_week_is_guest(v_me) end,
    'enrolled', v_member.account_id is not null,
    'credits_used', v_used,
    'credits_left', greatest(c.credits_per_account - v_used, 0),
    'phone_on_file', v_phone
  );
end;
$$;

grant execute on function public.free_week_status() to anon, authenticated;

-- Doctors taking part (only ones already visible in the public directory).
create or replace function public.free_week_doctors_list()
returns table (doctor_id uuid, daily_free_cap int, free_left_today int, open_slots int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  today date := (now() at time zone 'Asia/Karachi')::date;
begin
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase not in ('preregister', 'open') then
    return;
  end if;

  return query
  select
    fd.doctor_id,
    fd.daily_free_cap,
    greatest(fd.daily_free_cap - (
      select count(*)::int
      from public.free_week_claims fc
      join public.consultations co on co.id = fc.consultation_id
      where fc.campaign_id = c.id and fc.doctor_id = fd.doctor_id and co.status <> 'cancelled'
        and (co.created_at at time zone 'Asia/Karachi')::date = today
    ), 0) as free_left_today,
    (
      select count(*)::int
      from public.free_week_slots fs
      join public.doctor_availability_slots s on s.id = fs.slot_id
      where fs.campaign_id = c.id and s.doctor_id = fd.doctor_id and s.start_time > now()
        and s.capacity > (
          select count(*) from public.consultations co2
          where co2.slot_id = s.id
            and public.consultation_holds_slot(co2.status, co2.created_at, co2.slot_hold_until)
        )
    ) as open_slots
  from public.free_week_doctors fd
  join public.public_doctor_directory d on d.id = fd.doctor_id
  where fd.campaign_id = c.id and fd.opted_in;
end;
$$;

grant execute on function public.free_week_doctors_list() to anon, authenticated;

-- Open free-week times (separate from list_open_slots, which hides them).
create or replace function public.free_week_open_slots()
returns table (id uuid, doctor_id uuid, start_time timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
begin
  select * into c from public.free_week_pick();
  if public.free_week_phase(c) <> 'open' then
    return;
  end if;
  return query
  select s.id, s.doctor_id, s.start_time
  from public.free_week_slots fs
  join public.doctor_availability_slots s on s.id = fs.slot_id
  join public.free_week_doctors fd on fd.campaign_id = c.id and fd.doctor_id = s.doctor_id and fd.opted_in
  join public.public_doctor_directory d on d.id = s.doctor_id
  where fs.campaign_id = c.id
    and s.start_time > now()
    and s.capacity > (
      select count(*) from public.consultations co
      where co.slot_id = s.id
        and public.consultation_holds_slot(co.status, co.created_at, co.slot_hold_until)
    )
  order by s.start_time asc;
end;
$$;

grant execute on function public.free_week_open_slots() to anon, authenticated;

-- ------------------------------------------- paid booking never sees them

-- Identical to the 0072 definition plus one condition: a time that belongs
-- to the free week is not offered to paid booking (and therefore not counted
-- in "next available" either, which is built on this function).
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
    and not exists (select 1 from public.free_week_slots f where f.slot_id = s.id)
  group by s.id, s.doctor_id, s.start_time, s.capacity
  having s.capacity - count(c.id) > 0
  order by s.start_time asc;
$$;

-- A free-week time can only be booked through free_week_claim(), never as a
-- paid booking by calling the API directly.
create or replace function public.free_week_slot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slot_id is not null
     and coalesce(current_setting('app.free_week_claim', true), '') <> '1'
     and exists (select 1 from public.free_week_slots f where f.slot_id = new.slot_id) then
    raise exception 'That time is reserved for the free consultation week.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_consultation_free_week_slot_guard on public.consultations;
create trigger on_consultation_free_week_slot_guard
  before insert on public.consultations
  for each row execute function public.free_week_slot_guard();

-- ------------------------------------------------------------- doctors

create or replace function public.free_week_my_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  fd public.free_week_doctors;
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    return jsonb_build_object('phase', 'none');
  end if;
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase in ('none', 'ended') then
    return jsonb_build_object('phase', 'none');
  end if;
  select * into fd from public.free_week_doctors where campaign_id = c.id and doctor_id = v_me;
  return jsonb_build_object(
    'phase', v_phase,
    'name', c.name,
    'starts_on', c.starts_on,
    'ends_on', c.ends_on,
    'modes', to_jsonb(c.modes),
    'opted_in', coalesce(fd.opted_in, false),
    'daily_free_cap', coalesce(fd.daily_free_cap, 5),
    'free_visits_total', (
      select count(*)::int from public.free_week_claims fc
      join public.consultations co on co.id = fc.consultation_id
      where fc.campaign_id = c.id and fc.doctor_id = v_me and co.status <> 'cancelled'
    )
  );
end;
$$;

grant execute on function public.free_week_my_state() to authenticated;

create or replace function public.free_week_set_optin(
  p_opt_in boolean,
  p_daily_cap int default null,
  p_accept_terms boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_cap int := coalesce(p_daily_cap, 5);
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    raise exception 'Only doctors can join the free consultation week.';
  end if;
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase in ('none', 'ended') then
    raise exception 'There is no free consultation week running right now.';
  end if;
  if v_cap < 1 or v_cap > 20 then
    raise exception 'Please choose between 1 and 20 free consultations a day.';
  end if;

  if p_opt_in then
    if not coalesce(p_accept_terms, false) then
      raise exception 'Please confirm the free week terms to take part.';
    end if;
    insert into public.free_week_doctors (campaign_id, doctor_id, opted_in, daily_free_cap, terms_accepted_at, opted_at, withdrawn_at)
    values (c.id, v_me, true, v_cap, now(), now(), null)
    on conflict (campaign_id, doctor_id) do update
      set opted_in = true,
          daily_free_cap = excluded.daily_free_cap,
          terms_accepted_at = coalesce(public.free_week_doctors.terms_accepted_at, excluded.terms_accepted_at),
          withdrawn_at = null;
  else
    update public.free_week_doctors
       set opted_in = false, withdrawn_at = now()
     where campaign_id = c.id and doctor_id = v_me;
  end if;
end;
$$;

grant execute on function public.free_week_set_optin(boolean, int, boolean) to authenticated;

-- A doctor publishes free audio times for one day: from..to in 3/4/5 minute
-- steps (Pakistan time). Times where the doctor already has a slot are
-- skipped, never overwritten.
create or replace function public.free_week_add_slots(
  p_day date,
  p_from time,
  p_to time,
  p_minutes int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_t timestamptz;
  v_end timestamptz;
  v_created int := 0;
  v_skipped int := 0;
  v_existing int;
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    raise exception 'Only doctors can publish free-week times.';
  end if;
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase not in ('draft', 'preregister', 'open') then
    raise exception 'There is no free consultation week running right now.';
  end if;
  if not 'audio' = any (c.modes) then
    raise exception 'Audio calls are not part of this free week.';
  end if;
  if not exists (select 1 from public.free_week_doctors where campaign_id = c.id and doctor_id = v_me and opted_in) then
    raise exception 'Please join the free week first.';
  end if;
  if p_day is null or p_day < c.starts_on or p_day > c.ends_on then
    raise exception 'Free times must fall between % and %.', c.starts_on, c.ends_on;
  end if;
  if p_minutes is null or p_minutes not in (3, 4, 5) then
    raise exception 'Each time must be 3, 4 or 5 minutes.';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'The end time must be after the start time.';
  end if;

  v_t := (p_day::timestamp + p_from) at time zone 'Asia/Karachi';
  v_end := (p_day::timestamp + p_to) at time zone 'Asia/Karachi';
  if ((extract(epoch from (v_end - v_t)) / 60)::int / p_minutes) > 40 then
    raise exception 'Please keep it to 40 free times in one go.';
  end if;

  -- Serialise this doctor's free-time writes.
  perform pg_advisory_xact_lock(hashtextextended('fw-slots:' || v_me::text, 0));

  select count(*) into v_existing
  from public.free_week_slots fs
  join public.doctor_availability_slots s on s.id = fs.slot_id
  where s.doctor_id = v_me
    and (s.start_time at time zone 'Asia/Karachi')::date = p_day;
  if v_existing >= 80 then
    raise exception 'That day already has plenty of free times.';
  end if;

  while v_t + make_interval(mins => p_minutes) <= v_end loop
    if v_t <= now() or exists (
      select 1 from public.doctor_availability_slots s where s.doctor_id = v_me and s.start_time = v_t
    ) then
      v_skipped := v_skipped + 1;
    else
      with ins as (
        insert into public.doctor_availability_slots (doctor_id, start_time, capacity)
        values (v_me, v_t, 1)
        returning id
      )
      insert into public.free_week_slots (slot_id, campaign_id)
      select id, c.id from ins;
      v_created := v_created + 1;
    end if;
    v_t := v_t + make_interval(mins => p_minutes);
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

grant execute on function public.free_week_add_slots(date, time, time, int) to authenticated;

create or replace function public.free_week_my_slots()
returns table (id uuid, start_time timestamptz, booked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.start_time,
         exists (
           select 1 from public.consultations co
           where co.slot_id = s.id
             and public.consultation_holds_slot(co.status, co.created_at, co.slot_hold_until)
         ) as booked
  from public.free_week_slots fs
  join public.doctor_availability_slots s on s.id = fs.slot_id
  where s.doctor_id = auth.uid() and s.start_time > now() - interval '1 day'
  order by s.start_time asc
  limit 400;
$$;

grant execute on function public.free_week_my_slots() to authenticated;

create or replace function public.free_week_remove_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.free_week_slots fs
    join public.doctor_availability_slots s on s.id = fs.slot_id
    where fs.slot_id = p_slot_id and s.doctor_id = auth.uid()
  ) then
    raise exception 'That free time was not found.';
  end if;
  if exists (select 1 from public.consultations where slot_id = p_slot_id) then
    raise exception 'Someone has already booked that time, so it cannot be removed.';
  end if;
  delete from public.doctor_availability_slots where id = p_slot_id;
end;
$$;

grant execute on function public.free_week_remove_slot(uuid) to authenticated;

-- ------------------------------------------------------------- families

create or replace function public.free_week_enrol(p_phone text, p_marketing_consent boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_norm text := public.free_week_norm_phone(p_phone);
  v_existing public.free_week_members;
begin
  if v_me is null then
    raise exception 'Please log in or create an account first.';
  end if;
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase not in ('preregister', 'open') then
    raise exception 'Registration for the free week is not open right now.';
  end if;
  if public.free_week_is_guest(v_me) then
    raise exception 'Free consultations are for registered accounts. Please create a free account first.';
  end if;
  if v_norm is null then
    raise exception 'Please enter a valid mobile number, for example 0300 1234567.';
  end if;

  select * into v_existing from public.free_week_members where campaign_id = c.id and account_id = v_me;
  if found then
    -- Already registered: the mobile number is fixed; only the message
    -- preference can change.
    update public.free_week_members
       set marketing_consent = coalesce(p_marketing_consent, false),
           consent_at = case when coalesce(p_marketing_consent, false) then coalesce(consent_at, now()) else null end
     where campaign_id = c.id and account_id = v_me;
    return;
  end if;

  if exists (select 1 from public.free_week_members where campaign_id = c.id and phone_norm = v_norm) then
    raise exception 'This mobile number is already registered for the free week on another account. Each family can register once.';
  end if;

  begin
    insert into public.free_week_members (campaign_id, account_id, phone_norm, marketing_consent, consent_at)
    values (c.id, v_me, v_norm, coalesce(p_marketing_consent, false),
            case when coalesce(p_marketing_consent, false) then now() else null end);
  exception when unique_violation then
    raise exception 'This mobile number is already registered for the free week on another account. Each family can register once.';
  end;

  -- Keep the number on the profile too, if the profile has none yet.
  update public.patient_profiles set phone = btrim(p_phone), updated_at = now()
   where id = v_me and nullif(btrim(coalesce(phone, '')), '') is null;
end;
$$;

grant execute on function public.free_week_enrol(text, boolean) to authenticated;

-- The booking itself. Creates the consultation directly as 'submitted'.
create or replace function public.free_week_claim(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_complaint text,
  p_delivery_mode text,
  p_slot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  v_phase text;
  v_me uuid := auth.uid();
  v_cap int;
  v_used int;
  v_all int;
  v_doc_day int;
  v_day date;
  v_start timestamptz;
  v_new uuid;
begin
  if v_me is null then
    raise exception 'Please log in to claim a free consultation.';
  end if;
  select * into c from public.free_week_pick();
  v_phase := public.free_week_phase(c);
  if v_phase <> 'open' then
    raise exception 'The free consultation week is not open right now.';
  end if;
  if public.free_week_is_guest(v_me) then
    raise exception 'Free consultations are for registered accounts. Please create a free account first.';
  end if;
  if not exists (select 1 from public.free_week_members where campaign_id = c.id and account_id = v_me) then
    raise exception 'Please register for the free week first (your mobile number is needed).';
  end if;
  if not exists (select 1 from public.family_members where id = p_patient_id and account_id = v_me) then
    raise exception 'You can only book for people in your own account.';
  end if;
  if p_delivery_mode is null or not p_delivery_mode = any (c.modes) then
    raise exception 'Free consultations are available by text or audio call only.';
  end if;
  if nullif(btrim(coalesce(p_complaint, '')), '') is null then
    raise exception 'Please choose the reason for the visit.';
  end if;

  -- One claim at a time per account and per doctor, so a double click or two
  -- phones can never pass the limits together.
  perform pg_advisory_xact_lock(hashtextextended('fw-acc:' || v_me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('fw-doc:' || p_doctor_id::text, 0));

  select fd.daily_free_cap into v_cap
  from public.free_week_doctors fd
  join public.public_doctor_directory d on d.id = fd.doctor_id
  where fd.campaign_id = c.id and fd.doctor_id = p_doctor_id and fd.opted_in;
  if v_cap is null then
    raise exception 'This doctor is not offering free consultations right now.';
  end if;

  v_used := public.free_week_credits_used(c.id, v_me);
  if v_used >= c.credits_per_account then
    raise exception 'You have used all % free consultations for your account.', c.credits_per_account;
  end if;
  if c.overall_cap is not null then
    select count(*)::int into v_all
    from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
    where fc.campaign_id = c.id and co.status <> 'cancelled';
    if v_all >= c.overall_cap then
      raise exception 'All free consultations for this week have now been taken. Thank you for your interest.';
    end if;
  end if;

  if p_delivery_mode = 'audio' then
    select s.start_time into v_start
    from public.doctor_availability_slots s
    join public.free_week_slots fs on fs.slot_id = s.id and fs.campaign_id = c.id
    where s.id = p_slot_id and s.doctor_id = p_doctor_id;
    if v_start is null or v_start <= now() then
      raise exception 'That time is no longer available. Please choose another.';
    end if;
    v_day := (v_start at time zone 'Asia/Karachi')::date;
  else
    if p_slot_id is not null then
      raise exception 'Text consultations do not use a time slot.';
    end if;
    v_day := (now() at time zone 'Asia/Karachi')::date;
  end if;

  select count(*)::int into v_doc_day
  from public.free_week_claims fc
  join public.consultations co on co.id = fc.consultation_id
  left join public.doctor_availability_slots s on s.id = co.slot_id
  where fc.campaign_id = c.id and fc.doctor_id = p_doctor_id and co.status <> 'cancelled'
    and coalesce((s.start_time at time zone 'Asia/Karachi')::date,
                 (co.created_at at time zone 'Asia/Karachi')::date) = v_day;
  if v_doc_day >= v_cap then
    raise exception 'This doctor has given all their free consultations for that day. Please choose another day or doctor.';
  end if;

  perform set_config('app.free_week_claim', '1', true);
  insert into public.consultations (patient_id, doctor_id, complaint, delivery_mode, slot_id, status)
  values (p_patient_id, p_doctor_id, btrim(p_complaint), p_delivery_mode,
          case when p_delivery_mode = 'audio' then p_slot_id else null end, 'submitted')
  returning id into v_new;
  perform set_config('app.free_week_claim', '', true);

  insert into public.free_week_claims (campaign_id, account_id, consultation_id, doctor_id, delivery_mode)
  values (c.id, v_me, v_new, p_doctor_id, p_delivery_mode);

  return v_new;
end;
$$;

grant execute on function public.free_week_claim(uuid, uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------- admin

create or replace function public.admin_free_week_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select * into c from public.free_week_campaigns order by created_at desc limit 1;
  if c.id is null then
    return jsonb_build_object('exists', false);
  end if;
  return to_jsonb(c) || jsonb_build_object('exists', true, 'phase', public.free_week_phase(c));
end;
$$;

grant execute on function public.admin_free_week_get() to authenticated;

-- Create or update THE campaign (one row is kept; edits change it in place).
create or replace function public.admin_free_week_save(
  p_name text,
  p_opens_on date,
  p_starts_on date,
  p_ends_on date,
  p_active boolean,
  p_credits int,
  p_overall_cap int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select id into v_id from public.free_week_campaigns order by created_at desc limit 1;
  if v_id is null then
    insert into public.free_week_campaigns
      (name, opens_on, starts_on, ends_on, active, credits_per_account, overall_cap)
    values (coalesce(nullif(btrim(p_name), ''), 'Free Family Consultation Week'),
            p_opens_on, p_starts_on, p_ends_on, coalesce(p_active, false),
            coalesce(p_credits, 3), p_overall_cap)
    returning id into v_id;
  else
    update public.free_week_campaigns
       set name = coalesce(nullif(btrim(p_name), ''), name),
           opens_on = p_opens_on, starts_on = p_starts_on, ends_on = p_ends_on,
           active = coalesce(p_active, false),
           credits_per_account = coalesce(p_credits, credits_per_account),
           overall_cap = p_overall_cap
     where id = v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function public.admin_free_week_save(text, date, date, date, boolean, int, int) to authenticated;

create or replace function public.admin_free_week_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
  r jsonb;
  v_doctors jsonb;
  v_has_ratings boolean := to_regclass('public.doctor_rating_summary') is not null;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select * into c from public.free_week_campaigns order by created_at desc limit 1;
  if c.id is null then
    return jsonb_build_object('exists', false);
  end if;

  r := jsonb_build_object(
    'exists', true,
    'phase', public.free_week_phase(c),
    'families_registered', (select count(*) from public.free_week_members where campaign_id = c.id),
    'families_consenting', (select count(*) from public.free_week_members where campaign_id = c.id and marketing_consent),
    'families_booked', (select count(distinct account_id) from public.free_week_claims fc
                          join public.consultations co on co.id = fc.consultation_id
                         where fc.campaign_id = c.id and co.status <> 'cancelled'),
    'visits_booked', (select count(*) from public.free_week_claims fc
                        join public.consultations co on co.id = fc.consultation_id
                       where fc.campaign_id = c.id and co.status <> 'cancelled'),
    'visits_completed', (select count(*) from public.free_week_claims fc
                           join public.consultations co on co.id = fc.consultation_id
                          where fc.campaign_id = c.id and co.status = 'completed'),
    'visits_cancelled', (select count(*) from public.free_week_claims fc
                           join public.consultations co on co.id = fc.consultation_id
                          where fc.campaign_id = c.id and co.status = 'cancelled'),
    'visits_text', (select count(*) from public.free_week_claims fc
                      join public.consultations co on co.id = fc.consultation_id
                     where fc.campaign_id = c.id and co.status <> 'cancelled' and fc.delivery_mode = 'text'),
    'visits_audio', (select count(*) from public.free_week_claims fc
                       join public.consultations co on co.id = fc.consultation_id
                      where fc.campaign_id = c.id and co.status <> 'cancelled' and fc.delivery_mode = 'audio'),
    'doctors_opted_in', (select count(*) from public.free_week_doctors where campaign_id = c.id and opted_in),
    -- Families that had a completed free visit and later paid for a normal one.
    'families_completed_free', (select count(distinct fc.account_id) from public.free_week_claims fc
                                  join public.consultations co on co.id = fc.consultation_id
                                 where fc.campaign_id = c.id and co.status = 'completed'),
    'families_paid_after', (
      select count(distinct fc.account_id)
      from public.free_week_claims fc
      join public.consultations co on co.id = fc.consultation_id and co.status = 'completed'
      join public.payments p on p.account_id = fc.account_id and p.status = 'succeeded'
       and coalesce(p.gateway_environment, 'production') = 'production'
       and p.created_at >= c.starts_on::timestamp at time zone 'Asia/Karachi'
      where fc.campaign_id = c.id
        and not exists (select 1 from public.free_week_claims f2 where f2.consultation_id = p.consultation_id)
    ),
    'paid_revenue_pkr', coalesce((
      select sum(p.amount)
      from public.payments p
      where p.status = 'succeeded' and coalesce(p.gateway_environment, 'production') = 'production'
        and p.created_at >= c.starts_on::timestamp at time zone 'Asia/Karachi'
        and p.account_id in (select account_id from public.free_week_members where campaign_id = c.id)
        and not exists (select 1 from public.free_week_claims f2 where f2.consultation_id = p.consultation_id)
    ), 0)
  );

  v_doctors := coalesce((
    select jsonb_agg(row_to_json(t) order by t.visits desc, t.full_name)
    from (
      select dp.id as doctor_id,
             dp.full_name,
             fd.opted_in,
             fd.daily_free_cap,
             (select count(*) from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
               where fc.campaign_id = c.id and fc.doctor_id = dp.id and co.status <> 'cancelled') as visits,
             (select count(*) from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
               where fc.campaign_id = c.id and fc.doctor_id = dp.id and co.status = 'completed') as completed,
             (select count(*) from public.free_week_slots fs join public.doctor_availability_slots s on s.id = fs.slot_id
               where fs.campaign_id = c.id and s.doctor_id = dp.id) as free_slots
      from public.free_week_doctors fd
      join public.doctor_profiles dp on dp.id = fd.doctor_id
      where fd.campaign_id = c.id
    ) t
  ), '[]'::jsonb);

  -- Add star ratings if the ratings migration (0080) has been run.
  if v_has_ratings then
    v_doctors := coalesce((
      select jsonb_agg(
        d || jsonb_build_object('avg_rating', rs.avg_rating, 'review_count', rs.review_count)
        order by (d ->> 'visits')::int desc, d ->> 'full_name')
      from jsonb_array_elements(v_doctors) d
      left join public.doctor_rating_summary rs on rs.doctor_id = (d ->> 'doctor_id')::uuid
    ), '[]'::jsonb);
  end if;

  return r || jsonb_build_object('doctors', v_doctors);
end;
$$;

grant execute on function public.admin_free_week_report() to authenticated;

-- Families list (for the follow-up message to families who said yes).
create or replace function public.admin_free_week_families()
returns table (
  full_name text,
  email text,
  mobile text,
  marketing_consent boolean,
  registered_at timestamptz,
  free_visits int,
  completed int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.free_week_campaigns;
begin
  if not exists (select 1 from public.admin_profiles where id = auth.uid()) then
    raise exception 'Admins only.';
  end if;
  select * into c from public.free_week_campaigns order by created_at desc limit 1;
  if c.id is null then
    return;
  end if;
  return query
  select
    coalesce(pp.full_name, '')::text,
    u.email::text,
    m.phone_norm::text,
    m.marketing_consent,
    m.created_at,
    (select count(*)::int from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
      where fc.campaign_id = c.id and fc.account_id = m.account_id and co.status <> 'cancelled'),
    (select count(*)::int from public.free_week_claims fc join public.consultations co on co.id = fc.consultation_id
      where fc.campaign_id = c.id and fc.account_id = m.account_id and co.status = 'completed')
  from public.free_week_members m
  join auth.users u on u.id = m.account_id
  left join public.patient_profiles pp on pp.id = m.account_id
  where m.campaign_id = c.id
  order by m.created_at desc
  limit 2000;
end;
$$;

grant execute on function public.admin_free_week_families() to authenticated;

-- Helpers are internal: only the functions above (which run as their owner)
-- call them.
revoke all on function public.free_week_pick() from public, anon, authenticated;
revoke all on function public.free_week_credits_used(uuid, uuid) from public, anon, authenticated;
revoke all on function public.free_week_is_guest(uuid) from public, anon, authenticated;
