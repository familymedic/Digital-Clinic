-- Family packages, part 1 of 4: tables, admin controls, doctor requests,
-- doctor invite lists and referral codes (2026-10-26).
--
-- A "package" is a monthly pack a doctor offers: a fixed price, a number of
-- family members who may use it, and a shared number of consultations by
-- text (with voice notes), audio or video. The admin creates a package for
-- a doctor (or approves a doctor's request); patients buy it once through
-- Safepay (part 3) and then start consultations with one tap (part 2).
--
-- This part ONLY adds new tables and functions. Nothing that exists today is
-- changed, and nothing shows to patients until the admin switches package
-- sales on (family_package_settings.sales_open, default OFF) AND a package
-- is active for a doctor.
--
-- Attribution rules (decided 2026-10-26): a family is "doctor-brought" when
--   1. the doctor put the patient's mobile number on their invite list, or
--   2. the patient's FIRST-EVER referral code on the account is this
--      doctor's code (first touch wins),
-- and "platform-brought" otherwise. Renewals keep the earlier tag.
--
-- ROLLBACK: see ROLLBACK-0088.sql (drops everything this file creates).

-- ------------------------------------------------------------ helpers

-- Same canonical form as src/lib/phone.ts (Pakistani numbers become
-- 92XXXXXXXXXX). Kept separate from free_week_norm_phone (0081) so this
-- migration does not depend on the free week being installed.
create or replace function public.package_norm_phone(p text)
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

create or replace function public.package_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

create or replace function public.package_is_guest(p_account uuid)
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

-- Reads an integer out of a JSON object with a friendly error.
create or replace function public.package_int(
  p_data jsonb, p_key text, p_min int, p_max int, p_label text, p_default int default null
)
returns int
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_data ->> p_key, '')), '');
  n int;
begin
  if v is null then
    if p_default is null then
      raise exception '% is required.', p_label;
    end if;
    return p_default;
  end if;
  begin
    n := v::numeric::int;
  exception when others then
    raise exception '% must be a whole number.', p_label;
  end;
  if n < p_min or n > p_max then
    raise exception '% must be between % and %.', p_label, p_min, p_max;
  end if;
  return n;
end;
$$;

-- ------------------------------------------------------------- tables

-- One row: the master switch for selling packages.
create table if not exists public.family_package_settings (
  id boolean primary key default true check (id),
  sales_open boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.family_package_settings (id) values (true) on conflict do nothing;

create table if not exists public.family_packages (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  name text not null default 'Family Pack',
  price_pkr int not null check (price_pkr between 100 and 200000),
  members_allowed int not null check (members_allowed between 1 and 8),
  consultations_total int not null check (consultations_total between 1 and 60),
  allow_text boolean not null default true,
  allow_audio boolean not null default false,
  allow_video boolean not null default false,
  audio_limit int check (audio_limit is null or audio_limit >= 0),
  video_limit int check (video_limit is null or video_limit >= 0),
  validity_days int not null default 30 check (validity_days between 1 and 366),
  rollover_enabled boolean not null default false,
  rollover_cap int not null default 0 check (rollover_cap >= 0),
  rollover_window_days int not null default 7 check (rollover_window_days between 0 and 60),
  doctor_share_own_pct int not null default 80 check (doctor_share_own_pct between 0 and 100),
  doctor_share_platform_pct int not null default 70 check (doctor_share_platform_pct between 0 and 100),
  reply_window_hours int not null default 24 check (reply_window_hours between 1 and 168),
  max_families int check (max_families is null or max_families > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_packages_has_mode check (allow_text or allow_audio or allow_video)
);
-- One live (active or paused) package per doctor.
create unique index if not exists family_packages_one_live_per_doctor
  on public.family_packages (doctor_id) where status in ('active', 'paused');
create index if not exists family_packages_doctor_idx on public.family_packages (doctor_id);

create table if not exists public.family_package_requests (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  name text not null default 'Family Pack',
  price_pkr int not null check (price_pkr between 100 and 200000),
  members_allowed int not null check (members_allowed between 1 and 8),
  consultations_total int not null check (consultations_total between 1 and 60),
  allow_text boolean not null default true,
  allow_audio boolean not null default false,
  allow_video boolean not null default false,
  video_limit int check (video_limit is null or video_limit >= 0),
  rollover_allowed boolean not null default false,
  max_families int check (max_families is null or max_families > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  admin_note text,
  package_id uuid references public.family_packages (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists family_package_requests_one_pending
  on public.family_package_requests (doctor_id) where status = 'pending';

-- A doctor's list of their OWN patients (by mobile number). A patient whose
-- registered mobile matches counts as doctor-brought.
create table if not exists public.family_package_invites (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  phone_norm text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (doctor_id, phone_norm)
);

-- Each doctor's personal referral code (used in ?ref= links).
create table if not exists public.family_package_ref_codes (
  doctor_id uuid primary key references public.doctor_profiles (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

-- First-touch referral on a patient account: the first code seen wins.
create table if not exists public.family_package_referrals (
  account_id uuid primary key references auth.users (id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per purchase (one pack bought by one family from one doctor).
-- The terms are COPIED here at purchase time so a later change to the
-- package never changes what a family already paid for.
create table if not exists public.family_package_purchases (
  id uuid primary key default gen_random_uuid(),   -- also Safepay metadata.order_id
  package_id uuid not null references public.family_packages (id),
  doctor_id uuid not null references public.doctor_profiles (id),
  account_id uuid not null references auth.users (id),
  price_pkr int not null check (price_pkr > 0),
  members_allowed int not null,
  consultations_total int not null,
  allow_text boolean not null,
  allow_audio boolean not null,
  allow_video boolean not null,
  audio_limit int,
  video_limit int,
  validity_days int not null,
  rollover_enabled boolean not null default false,
  rollover_cap int not null default 0,
  rollover_window_days int not null default 7,
  reply_window_hours int not null default 24,
  rollover_credits int not null default 0 check (rollover_credits >= 0),
  payment_method text not null default 'safepay' check (payment_method in ('safepay', 'manual')),
  gateway text,
  gateway_environment text,
  gateway_tracker_token text,
  status text not null default 'pending' check (status in ('pending', 'active', 'refunded', 'cancelled')),
  paid_at timestamptz,
  starts_at timestamptz,
  expires_at timestamptz,
  raw_payload jsonb,
  -- who brought the family, and the doctor's share saved at purchase time
  source text not null default 'platform' check (source in ('doctor', 'platform')),
  source_reason text,
  source_set_by uuid references auth.users (id),
  doctor_share_pct int not null check (doctor_share_pct between 0 and 100),
  doctor_share_pkr int,
  platform_share_pkr int,
  share_own_pct int,                -- the package's two shares, saved when the checkout starts
  share_platform_pct int,
  doctor_paid_at timestamptz,
  doctor_paid_pkr int,              -- what the doctor has actually been paid for this pack
  doctor_paid_note text,
  refunded_at timestamptz,
  refund_pkr int,
  refund_note text,
  rolled_to uuid,                   -- set when unused credits were carried into a renewal
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists family_package_purchases_tracker_uidx
  on public.family_package_purchases (gateway_tracker_token) where gateway_tracker_token is not null;
create index if not exists family_package_purchases_account_idx on public.family_package_purchases (account_id, created_at desc);
create index if not exists family_package_purchases_doctor_idx on public.family_package_purchases (doctor_id, status, expires_at);

-- Which family profiles have taken a place on a purchase.
create table if not exists public.family_package_members (
  purchase_id uuid not null references public.family_package_purchases (id) on delete cascade,
  family_member_id uuid not null references public.family_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (purchase_id, family_member_id)
);

-- One row per consultation started from a purchase = one credit used.
create table if not exists public.family_package_claims (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.family_package_purchases (id) on delete cascade,
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  family_member_id uuid not null references public.family_members (id),
  doctor_id uuid not null references public.doctor_profiles (id),
  delivery_mode text not null check (delivery_mode in ('text', 'audio', 'video')),
  state text not null default 'used' check (state in ('used', 'returned')),
  returned_at timestamptz,
  returned_by uuid references auth.users (id),
  return_reason text,
  created_at timestamptz not null default now()
);
create index if not exists family_package_claims_purchase_idx on public.family_package_claims (purchase_id);
create index if not exists family_package_claims_doctor_idx on public.family_package_claims (doctor_id, created_at desc);

-- ------------------------------------------------------ access (RLS)

alter table public.family_package_settings enable row level security;
alter table public.family_packages enable row level security;
alter table public.family_package_requests enable row level security;
alter table public.family_package_invites enable row level security;
alter table public.family_package_ref_codes enable row level security;
alter table public.family_package_referrals enable row level security;
alter table public.family_package_purchases enable row level security;
alter table public.family_package_members enable row level security;
alter table public.family_package_claims enable row level security;

revoke all on public.family_package_settings, public.family_packages, public.family_package_requests,
  public.family_package_invites, public.family_package_ref_codes, public.family_package_referrals,
  public.family_package_purchases, public.family_package_members, public.family_package_claims
  from anon, authenticated;

-- Everything is written by the functions below (or the server); the tables
-- are only READABLE directly, and only by the people concerned.
grant select on public.family_package_settings to authenticated;
grant select on public.family_packages to authenticated;
grant select on public.family_package_requests to authenticated;
grant select on public.family_package_invites to authenticated;
grant select on public.family_package_purchases to authenticated;
grant select on public.family_package_claims to authenticated;
grant all on public.family_package_settings, public.family_packages, public.family_package_requests,
  public.family_package_invites, public.family_package_ref_codes, public.family_package_referrals,
  public.family_package_purchases, public.family_package_members, public.family_package_claims
  to service_role;

drop policy if exists "Anyone signed in can read the sales switch" on public.family_package_settings;
create policy "Anyone signed in can read the sales switch"
  on public.family_package_settings for select to authenticated using (true);

drop policy if exists "Admins and the owning doctor read packages" on public.family_packages;
create policy "Admins and the owning doctor read packages"
  on public.family_packages for select
  using (doctor_id = auth.uid() or public.package_is_admin());

drop policy if exists "Admins and the requesting doctor read requests" on public.family_package_requests;
create policy "Admins and the requesting doctor read requests"
  on public.family_package_requests for select
  using (doctor_id = auth.uid() or public.package_is_admin());

drop policy if exists "Admins and the doctor read invites" on public.family_package_invites;
create policy "Admins and the doctor read invites"
  on public.family_package_invites for select
  using (doctor_id = auth.uid() or public.package_is_admin());

drop policy if exists "Buyer, doctor and admins read purchases" on public.family_package_purchases;
create policy "Buyer, doctor and admins read purchases"
  on public.family_package_purchases for select
  using (account_id = auth.uid() or doctor_id = auth.uid() or public.package_is_admin());

drop policy if exists "Buyer, doctor and admins read claims" on public.family_package_claims;
create policy "Buyer, doctor and admins read claims"
  on public.family_package_claims for select
  using (
    doctor_id = auth.uid()
    or public.package_is_admin()
    or exists (select 1 from public.family_package_purchases pu where pu.id = purchase_id and pu.account_id = auth.uid())
  );

-- ------------------------------------------------- shared calculations

-- Credits used by a purchase: claims not returned whose consultation was not
-- cancelled (a cancelled booking gives the credit back automatically).
create or replace function public.package_credits_used(p_purchase uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.family_package_claims cl
  join public.consultations co on co.id = cl.consultation_id
  where cl.purchase_id = p_purchase and cl.state = 'used' and co.status <> 'cancelled';
$$;

create or replace function public.package_credits_left(p_purchase uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, pu.consultations_total + pu.rollover_credits - public.package_credits_used(pu.id))
  from public.family_package_purchases pu where pu.id = p_purchase;
$$;

-- Families who currently hold a live pack with this doctor.
create or replace function public.package_active_families(p_doctor uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct account_id)::int
  from public.family_package_purchases
  where doctor_id = p_doctor and status = 'active' and expires_at > now();
$$;

-- ------------------------------------------------ what a patient sees

-- The pack a doctor currently sells, or null. Hides everything the public
-- must not see (shares, internal rules). Null while sales are switched off.
create or replace function public.package_public_for_doctor(p_doctor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pk public.family_packages%rowtype;
  v_open boolean;
  v_taken int;
  v_left int;
begin
  select sales_open into v_open from public.family_package_settings where id;
  if not coalesce(v_open, false) then
    return null;
  end if;
  select * into pk from public.family_packages where doctor_id = p_doctor_id and status = 'active';
  if not found then
    return null;
  end if;
  if not exists (select 1 from public.public_doctor_directory d where d.id = p_doctor_id) then
    return null;
  end if;
  v_taken := public.package_active_families(p_doctor_id);
  v_left := case when pk.max_families is null then null else greatest(0, pk.max_families - v_taken) end;
  return jsonb_build_object(
    'package_id', pk.id,
    'name', pk.name,
    'price_pkr', pk.price_pkr,
    'members_allowed', pk.members_allowed,
    'consultations_total', pk.consultations_total,
    'allow_text', pk.allow_text,
    'allow_audio', pk.allow_audio,
    'allow_video', pk.allow_video,
    'audio_limit', pk.audio_limit,
    'video_limit', pk.video_limit,
    'validity_days', pk.validity_days,
    'rollover_enabled', pk.rollover_enabled,
    'reply_window_hours', pk.reply_window_hours,
    'spots_left', v_left,
    'full', (v_left is not null and v_left <= 0)
  );
end;
$$;

grant execute on function public.package_public_for_doctor(uuid) to anon, authenticated;

-- First-touch referral: remember which doctor's link brought this account.
-- Called by the site when a signed-in patient arrives with ?ref=CODE.
create or replace function public.package_record_ref(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_doc uuid;
  v_n int;
begin
  if v_me is null or public.package_is_guest(v_me) then
    return jsonb_build_object('recorded', false);
  end if;
  if exists (select 1 from public.doctor_profiles where id = v_me) then
    return jsonb_build_object('recorded', false);
  end if;
  select doctor_id into v_doc from public.family_package_ref_codes where code = lower(btrim(coalesce(p_code, '')));
  if v_doc is null then
    return jsonb_build_object('recorded', false);
  end if;
  insert into public.family_package_referrals (account_id, doctor_id) values (v_me, v_doc)
  on conflict (account_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('recorded', v_n > 0);
end;
$$;

grant execute on function public.package_record_ref(text) to authenticated;

-- ------------------------------------------------------------- admin

create or replace function public.admin_package_set_sales(p_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  update public.family_package_settings set sales_open = coalesce(p_open, false), updated_at = now() where id;
end;
$$;

grant execute on function public.admin_package_set_sales(boolean) to authenticated;

-- Everything the admin Packages tab needs in one call.
create or replace function public.admin_package_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open boolean;
  v_pk jsonb;
  v_rq jsonb;
  v_docs jsonb;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select sales_open into v_open from public.family_package_settings where id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_pk
  from (
    select pk.*, d.full_name as doctor_name,
           public.package_active_families(pk.doctor_id) as active_families
    from public.family_packages pk
    join public.doctor_profiles d on d.id = pk.doctor_id
    where pk.status <> 'archived'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_rq
  from (
    select rq.*, d.full_name as doctor_name, d.specialty as doctor_specialty
    from public.family_package_requests rq
    join public.doctor_profiles d on d.id = rq.doctor_id
    where rq.status = 'pending' or rq.decided_at > now() - interval '30 days'
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'full_name', d.full_name, 'specialty', d.specialty) order by d.full_name), '[]'::jsonb)
    into v_docs
  from public.doctor_profiles d
  where d.verification_status = 'approved' and d.is_active;

  return jsonb_build_object('sales_open', coalesce(v_open, false), 'packages', v_pk, 'requests', v_rq, 'doctors', v_docs);
end;
$$;

grant execute on function public.admin_package_overview() to authenticated;

-- Create or update a package. p_data fields: id (to update), doctor_id,
-- name, price_pkr, members_allowed, consultations_total, allow_text,
-- allow_audio, allow_video, audio_limit, video_limit, validity_days,
-- rollover_enabled, rollover_cap, rollover_window_days,
-- doctor_share_own_pct, doctor_share_platform_pct, reply_window_hours,
-- max_families, status.
create or replace function public.admin_package_save(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_data ->> 'id', '')::uuid;
  v_doc uuid;
  v_status text := coalesce(nullif(p_data ->> 'status', ''), 'draft');
  v_total int;
  v_name text := coalesce(nullif(btrim(coalesce(p_data ->> 'name', '')), ''), 'Family Pack');
  v_text boolean := coalesce((p_data ->> 'allow_text')::boolean, true);
  v_audio boolean := coalesce((p_data ->> 'allow_audio')::boolean, false);
  v_video boolean := coalesce((p_data ->> 'allow_video')::boolean, false);
  v_alim int;
  v_vlim int;
  v_roll boolean := coalesce((p_data ->> 'rollover_enabled')::boolean, false);
  v_maxf int;
  v_new uuid;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  if v_status not in ('draft', 'active', 'paused', 'archived') then
    raise exception 'Unknown status.';
  end if;
  v_doc := nullif(p_data ->> 'doctor_id', '')::uuid;
  if v_doc is null and v_id is not null then
    select doctor_id into v_doc from public.family_packages where id = v_id;
  end if;
  if v_doc is null or not exists (select 1 from public.doctor_profiles where id = v_doc) then
    raise exception 'Please choose a doctor.';
  end if;
  if not (v_text or v_audio or v_video) then
    raise exception 'Choose at least one way of consulting.';
  end if;
  v_total := public.package_int(p_data, 'consultations_total', 1, 60, 'Number of consultations');
  v_alim := case when v_audio then nullif(btrim(coalesce(p_data ->> 'audio_limit', '')), '')::int end;
  v_vlim := case when v_video then nullif(btrim(coalesce(p_data ->> 'video_limit', '')), '')::int end;
  if (v_alim is not null and v_alim > v_total) or (v_vlim is not null and v_vlim > v_total) then
    raise exception 'An audio or video limit cannot be more than the total number of consultations.';
  end if;
  v_maxf := nullif(btrim(coalesce(p_data ->> 'max_families', '')), '')::int;
  if v_maxf is not null and v_maxf < 1 then
    raise exception 'Maximum families must be at least 1 (or left empty for no limit).';
  end if;

  if v_id is null then
    insert into public.family_packages (
      doctor_id, name, price_pkr, members_allowed, consultations_total, allow_text, allow_audio, allow_video,
      audio_limit, video_limit, validity_days, rollover_enabled, rollover_cap, rollover_window_days,
      doctor_share_own_pct, doctor_share_platform_pct, reply_window_hours, max_families, status, created_by
    ) values (
      v_doc, v_name,
      public.package_int(p_data, 'price_pkr', 100, 200000, 'Price'),
      public.package_int(p_data, 'members_allowed', 1, 8, 'Members allowed'),
      v_total, v_text, v_audio, v_video, v_alim, v_vlim,
      public.package_int(p_data, 'validity_days', 1, 366, 'Valid for (days)', 30),
      v_roll,
      case when v_roll then public.package_int(p_data, 'rollover_cap', 0, 60, 'Rollover cap', 0) else 0 end,
      public.package_int(p_data, 'rollover_window_days', 0, 60, 'Rollover window (days)', 7),
      public.package_int(p_data, 'doctor_share_own_pct', 0, 100, 'Doctor share when the doctor brings the family (%)', 80),
      public.package_int(p_data, 'doctor_share_platform_pct', 0, 100, 'Doctor share when Family Medic brings the family (%)', 70),
      public.package_int(p_data, 'reply_window_hours', 1, 168, 'Reply window (hours)', 24),
      v_maxf, v_status, auth.uid()
    ) returning id into v_new;
    return v_new;
  end if;

  update public.family_packages set
    doctor_id = v_doc,
    name = v_name,
    price_pkr = public.package_int(p_data, 'price_pkr', 100, 200000, 'Price'),
    members_allowed = public.package_int(p_data, 'members_allowed', 1, 8, 'Members allowed'),
    consultations_total = v_total,
    allow_text = v_text, allow_audio = v_audio, allow_video = v_video,
    audio_limit = v_alim, video_limit = v_vlim,
    validity_days = public.package_int(p_data, 'validity_days', 1, 366, 'Valid for (days)', 30),
    rollover_enabled = v_roll,
    rollover_cap = case when v_roll then public.package_int(p_data, 'rollover_cap', 0, 60, 'Rollover cap', 0) else 0 end,
    rollover_window_days = public.package_int(p_data, 'rollover_window_days', 0, 60, 'Rollover window (days)', 7),
    doctor_share_own_pct = public.package_int(p_data, 'doctor_share_own_pct', 0, 100, 'Doctor share when the doctor brings the family (%)', 80),
    doctor_share_platform_pct = public.package_int(p_data, 'doctor_share_platform_pct', 0, 100, 'Doctor share when Family Medic brings the family (%)', 70),
    reply_window_hours = public.package_int(p_data, 'reply_window_hours', 1, 168, 'Reply window (hours)', 24),
    max_families = v_maxf,
    status = v_status,
    updated_at = now()
  where id = v_id
  returning id into v_new;
  if v_new is null then
    raise exception 'That package no longer exists.';
  end if;
  return v_new;
exception when unique_violation then
  raise exception 'This doctor already has a live package. Pause or archive it first.';
end;
$$;

grant execute on function public.admin_package_save(jsonb) to authenticated;

create or replace function public.admin_package_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_status not in ('draft', 'active', 'paused', 'archived') then
    raise exception 'Unknown status.';
  end if;
  update public.family_packages set status = p_status, updated_at = now() where id = p_id;
  if not found then
    raise exception 'That package no longer exists.';
  end if;
exception when unique_violation then
  raise exception 'This doctor already has a live package. Pause or archive it first.';
end;
$$;

grant execute on function public.admin_package_set_status(uuid, text) to authenticated;

-- Approve (optionally with edited terms in p_data) or decline a request.
-- Approving makes the package active and archives the doctor's previous
-- live package (families who already bought it keep their own terms).
create or replace function public.admin_package_decide_request(
  p_request_id uuid, p_approve boolean, p_data jsonb default '{}'::jsonb, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rq public.family_package_requests%rowtype;
  v_data jsonb;
  v_new uuid;
begin
  if not public.package_is_admin() then
    raise exception 'Admins only.';
  end if;
  select * into rq from public.family_package_requests where id = p_request_id for update;
  if not found then
    raise exception 'That request no longer exists.';
  end if;
  if rq.status <> 'pending' then
    raise exception 'That request was already dealt with.';
  end if;

  if not coalesce(p_approve, false) then
    update public.family_package_requests
    set status = 'declined', admin_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now()
    where id = rq.id;
    return null;
  end if;

  update public.family_packages set status = 'archived', updated_at = now()
  where doctor_id = rq.doctor_id and status in ('active', 'paused');

  v_data := jsonb_build_object(
    'doctor_id', rq.doctor_id, 'name', rq.name, 'price_pkr', rq.price_pkr,
    'members_allowed', rq.members_allowed, 'consultations_total', rq.consultations_total,
    'allow_text', rq.allow_text, 'allow_audio', rq.allow_audio, 'allow_video', rq.allow_video,
    'video_limit', rq.video_limit, 'rollover_enabled', rq.rollover_allowed,
    'rollover_cap', case when rq.rollover_allowed then rq.consultations_total / 2 else 0 end,
    'max_families', rq.max_families, 'status', 'active'
  ) || coalesce(p_data, '{}'::jsonb) || jsonb_build_object('status', 'active', 'doctor_id', rq.doctor_id);
  v_data := v_data - 'id';
  v_new := public.admin_package_save(v_data);

  update public.family_package_requests
  set status = 'approved', package_id = v_new, admin_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now()
  where id = rq.id;
  return v_new;
end;
$$;

grant execute on function public.admin_package_decide_request(uuid, boolean, jsonb, text) to authenticated;

-- ------------------------------------------------------------ doctor

-- Doctor asks for a package. p_data: name, price_pkr, members_allowed,
-- consultations_total, allow_text, allow_audio, allow_video, video_limit,
-- rollover_allowed, max_families, note.
create or replace function public.doctor_package_request(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_total int;
  v_text boolean := coalesce((p_data ->> 'allow_text')::boolean, true);
  v_audio boolean := coalesce((p_data ->> 'allow_audio')::boolean, false);
  v_video boolean := coalesce((p_data ->> 'allow_video')::boolean, false);
  v_new uuid;
begin
  if v_me is null or not exists (
    select 1 from public.doctor_profiles where id = v_me and verification_status = 'approved' and is_active
  ) then
    raise exception 'Only approved doctors can request a package.';
  end if;
  if not (v_text or v_audio or v_video) then
    raise exception 'Choose at least one way of consulting.';
  end if;
  v_total := public.package_int(p_data, 'consultations_total', 1, 60, 'Number of consultations');
  insert into public.family_package_requests (
    doctor_id, name, price_pkr, members_allowed, consultations_total, allow_text, allow_audio, allow_video,
    video_limit, rollover_allowed, max_families, note
  ) values (
    v_me,
    coalesce(nullif(btrim(coalesce(p_data ->> 'name', '')), ''), 'Family Pack'),
    public.package_int(p_data, 'price_pkr', 100, 200000, 'Price'),
    public.package_int(p_data, 'members_allowed', 1, 8, 'Members per family'),
    v_total, v_text, v_audio, v_video,
    case when v_video then nullif(btrim(coalesce(p_data ->> 'video_limit', '')), '')::int end,
    coalesce((p_data ->> 'rollover_allowed')::boolean, false),
    nullif(btrim(coalesce(p_data ->> 'max_families', '')), '')::int,
    nullif(left(btrim(coalesce(p_data ->> 'note', '')), 600), '')
  ) returning id into v_new;
  return v_new;
exception when unique_violation then
  raise exception 'You already have a request waiting for review.';
end;
$$;

grant execute on function public.doctor_package_request(jsonb) to authenticated;

create or replace function public.doctor_package_withdraw_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.family_package_requests set status = 'withdrawn', decided_at = now()
  where doctor_id = auth.uid() and status = 'pending';
end;
$$;

grant execute on function public.doctor_package_withdraw_request() to authenticated;

-- The doctor can pause or resume NEW sales of their live package.
create or replace function public.doctor_package_set_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Please log in.';
  end if;
  update public.family_packages
  set status = case when coalesce(p_paused, false) then 'paused' else 'active' end, updated_at = now()
  where doctor_id = auth.uid() and status in ('active', 'paused');
  if not found then
    raise exception 'You do not have a live package.';
  end if;
end;
$$;

grant execute on function public.doctor_package_set_paused(boolean) to authenticated;

-- Doctor's personal referral code (created on first use).
create or replace function public.doctor_package_ref_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_code text;
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    raise exception 'Only doctors have a referral code.';
  end if;
  select code into v_code from public.family_package_ref_codes where doctor_id = v_me;
  if v_code is not null then
    return v_code;
  end if;
  loop
    v_code := substr(md5(random()::text || clock_timestamp()::text || v_me::text), 1, 8);
    begin
      insert into public.family_package_ref_codes (doctor_id, code) values (v_me, v_code);
      exit;
    exception when unique_violation then
      select code into v_code from public.family_package_ref_codes where doctor_id = v_me;
      if v_code is not null then
        exit;
      end if;
    end;
  end loop;
  return v_code;
end;
$$;

grant execute on function public.doctor_package_ref_code() to authenticated;

-- Add several of the doctor's own patients by mobile number (one per line
-- or separated by commas). Returns how many were added and which were
-- skipped as not valid.
create or replace function public.doctor_package_invite_add(p_numbers text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_raw text;
  v_norm text;
  v_added int := 0;
  v_bad text[] := '{}';
  v_n int;
begin
  if v_me is null or not exists (select 1 from public.doctor_profiles where id = v_me) then
    raise exception 'Only doctors can add patients.';
  end if;
  for v_raw in select btrim(x) from regexp_split_to_table(coalesce(p_numbers, ''), '[,\n;]+') as x loop
    continue when v_raw = '';
    v_norm := public.package_norm_phone(v_raw);
    if v_norm is null then
      v_bad := v_bad || v_raw;
      continue;
    end if;
    insert into public.family_package_invites (doctor_id, phone_norm) values (v_me, v_norm)
    on conflict (doctor_id, phone_norm) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return jsonb_build_object('added', v_added, 'invalid', to_jsonb(v_bad));
end;
$$;

grant execute on function public.doctor_package_invite_add(text) to authenticated;

create or replace function public.doctor_package_invite_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.family_package_invites where id = p_id and doctor_id = auth.uid();
end;
$$;

grant execute on function public.doctor_package_invite_remove(uuid) to authenticated;
