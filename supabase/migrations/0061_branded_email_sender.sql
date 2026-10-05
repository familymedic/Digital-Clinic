-- Branded email sender (2026-10-04).
--
-- The domain thefamilymedic.com is now verified with Resend, so the
-- app can send from contact@thefamilymedic.com instead of Resend's
-- shared test address onboarding@resend.dev (which only delivers to the
-- Resend account owner's own inbox).
--
-- The old address is hardcoded inside several database notification
-- functions (originally 0012/0013, 0039, 0049, and possibly later
-- versions that live only in the production database). Rather than
-- re-declare each function by hand from the repo copy (which could
-- silently revert a newer live version), this migration looks at the
-- functions that are ACTUALLY in the database right now, rewrites only
-- the sender address inside their own current source, and re-creates
-- them. Nothing else about any function changes: same name, arguments,
-- owner, security setting and grants (CREATE OR REPLACE keeps them).
--
-- Safe to run more than once: after the first run no function contains
-- the old address, so later runs change nothing.
--
-- Run ONLY after Resend shows the domain as "Verified" - until then the
-- new sender would be rejected and these emails would stop sending.

do $$
declare
  f record;
  new_def text;
  changed int := 0;
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc like '%onboarding@resend.dev%'
  loop
    new_def := f.def;
    -- Display names first (so "AI Clinic Assistant <...>" becomes the
    -- product name), then the address itself.
    new_def := replace(new_def, 'AI Clinic Assistant <onboarding@resend.dev>', 'Family Medic <contact@thefamilymedic.com>');
    new_def := replace(new_def, 'Family Medic <onboarding@resend.dev>',        'Family Medic <contact@thefamilymedic.com>');
    new_def := replace(new_def, 'onboarding@resend.dev',                        'contact@thefamilymedic.com');
    execute new_def;
    changed := changed + 1;
    raise notice 'Updated sender in function: %', f.proname;
  end loop;
  raise notice 'Branded sender applied to % function(s).', changed;
end
$$;

-- Check (should return zero rows):
--   select proname from pg_proc where prosrc like '%onboarding@resend.dev%';
