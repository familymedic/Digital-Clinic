-- Phase 3: minimal patient profile table.
--
-- Supabase's built-in `auth.users` table already handles email + password
-- for us (that's what /register and /login talk to). This table holds the
-- extra fields we actually need — name and phone — linked 1-to-1 to that
-- built-in user record. Nothing more is collected here, per the blueprint's
-- minimal-data-collection principle (Section 5).

create table if not exists public.patient_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row Level Security: a patient can only ever see or change their OWN row.
-- This is enforced by the database itself, not just by the app's code —
-- per the blueprint's "database-level role-based access" principle
-- (Section 6). No policy for doctors/admins exists yet; that arrives when
-- the doctor dashboard (Phase 7) needs it, and will be added deliberately.

alter table public.patient_profiles enable row level security;

create policy "Patients can view their own profile"
  on public.patient_profiles for select
  using (auth.uid() = id);

create policy "Patients can update their own profile"
  on public.patient_profiles for update
  using (auth.uid() = id);

-- Automatically create a patient_profiles row the moment someone signs up,
-- using the name/phone they entered at registration. This runs inside the
-- database itself (a trigger), so a profile can never be "forgotten" due
-- to a network hiccup between two separate app-side steps.

create or replace function public.handle_new_patient_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.patient_profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_patient_user();
