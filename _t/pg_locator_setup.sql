-- Minimal Supabase stand-ins so migration 0095 can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table if not exists public.admin_profiles (id uuid primary key references auth.users(id), full_name text);
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on public.admin_profiles to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase gives the API roles default privileges on new public tables/functions; RLS and
-- explicit revokes in the migration then decide who can really do what.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
