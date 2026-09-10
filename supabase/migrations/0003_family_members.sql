-- Phase 4b: Family accounts.
--
-- One login no longer has to mean one patient. A single account holder
-- (e.g. a father) can now manage consultations for several people —
-- himself, his spouse, his children, his parents — without each of them
-- needing their own login. This replaces the 1-to-1 assumption in
-- `patient_profiles` (0001) with a 1-to-many model:
--
--   auth.users (the login)  --<  family_members (the people who receive care)  --<  consultations
--
-- This migration is safe to run on its own. It does not require
-- 0002_consultations.sql to have been run first — it creates the
-- consultations table itself, with the new shape. If you already ran
-- 0002, this migration replaces that table; nothing built on top of it
-- yet, so there is no real data to lose (Section 41: synthetic data only
-- during development).

-- 1. family_members: the people who can receive care under an account.
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  -- 'self' | 'spouse' | 'child' | 'parent' | 'sibling' | 'other'
  relationship text not null default 'self',
  date_of_birth date,
  -- Required only for adults added by someone else (Section 38 decision:
  -- "free to add, with an attestation"). A parent/guardian adding a minor
  -- child does not need this — that's ordinary parental authority, not a
  -- database-enforced legal judgment.
  attestation_confirmed boolean not null default false,
  attestation_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.family_members enable row level security;

drop policy if exists "Account holders can view their family members" on public.family_members;
create policy "Account holders can view their family members"
  on public.family_members for select
  using (auth.uid() = account_id);

drop policy if exists "Account holders can add family members" on public.family_members;
create policy "Account holders can add family members"
  on public.family_members for insert
  with check (auth.uid() = account_id);

drop policy if exists "Account holders can update their family members" on public.family_members;
create policy "Account holders can update their family members"
  on public.family_members for update
  using (auth.uid() = account_id);

-- 2. Carry forward anyone already registered under the old model
--    (Phase 3's patient_profiles) as their own "self" family member, so
--    an existing test account keeps working after this migration.
do $$
begin
  if to_regclass('public.patient_profiles') is not null then
    insert into public.family_members
      (id, account_id, full_name, relationship, attestation_confirmed, attestation_at, created_at)
    select
      gen_random_uuid(), id, coalesce(nullif(full_name, ''), 'Account holder'),
      'self', true, created_at, created_at
    from public.patient_profiles
    where not exists (
      select 1 from public.family_members fm
      where fm.account_id = patient_profiles.id and fm.relationship = 'self'
    );
  end if;
end $$;

-- 3. Replace the Phase 3 signup trigger (which created a patient_profiles
--    row) with one that creates a "self" family_members row instead.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_patient_user();

create or replace function public.handle_new_account_self_member()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.family_members (account_id, full_name, relationship, attestation_confirmed, attestation_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Account holder'),
    'self',
    true,
    now()
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_account_self_member();

-- 4. consultations now attaches to a family_members row, not directly to
--    auth.users. Also adds `doctor_id` now (nullable, unused until the
--    doctor dashboard in Phase 7) rather than as a later, separate
--    schema change — Section 2/22's documented "every Consultation
--    carries a doctor_id from day one" decision, folded in here because
--    we are already touching this table's relationships (Section 38:
--    flagged, not silent).
drop table if exists public.consultations;

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.family_members (id) on delete cascade,
  doctor_id uuid references auth.users (id),
  complaint text not null,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

alter table public.consultations enable row level security;

drop policy if exists "Account holders can view their family's consultations" on public.consultations;
create policy "Account holders can view their family's consultations"
  on public.consultations for select
  using (
    patient_id in (select id from public.family_members where account_id = auth.uid())
  );

drop policy if exists "Account holders can book for their family" on public.consultations;
create policy "Account holders can book for their family"
  on public.consultations for insert
  with check (
    patient_id in (select id from public.family_members where account_id = auth.uid())
  );

-- No doctor-facing policy yet — same deliberate deferral as 0002,
-- arrives with the doctor dashboard (Phase 7).

-- 5. patient_profiles is superseded by family_members. Everything it
--    held (full_name, phone) either moved to family_members or is easy
--    to re-collect from a synthetic test account, so it's dropped rather
--    than kept as an unused duplicate table.
drop table if exists public.patient_profiles;
