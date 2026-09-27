-- Family member remove/edit (2026-09-27, physician: "i cannot remove
-- family member"). This has been a known gap since the 2026-09-18 go-live
-- checklist (Section 11: "if a patient fat-fingers a date of birth
-- today, there's no self-service fix") — now built.
--
-- Deliberately a SOFT delete (an `archived_at` timestamp), never a hard
-- DELETE. consultations.patient_id references family_members(id) ON
-- DELETE CASCADE (0003) — a real DELETE here would permanently destroy
-- every consultation, prescription, and uploaded document that family
-- member ever had, which would violate this app's own established
-- principle that a clinical record reads as permanent (0022's message
-- threads, 0042's patient documents, 0047's agreement acceptances all
-- already follow this same "never actually erase" rule). Archiving a
-- family member only removes them from the active "Family members" list
-- and the "book a consultation for" picker going forward — their full
-- consultation and document history stays exactly where it is and stays
-- fully visible to the account holder.
--
-- No RLS change needed for the archive/edit action itself: the existing
-- "Account holders can update their family members" UPDATE policy (0003)
-- already covers setting this new column, the same way it already
-- covers editing full_name/relationship/date_of_birth.

alter table public.family_members
  add column if not exists archived_at timestamptz;

-- Defense in depth: the account holder's own "self" row (created
-- automatically at signup, 0003) should never be archivable — archiving
-- it would silently break "who does this login even belong to" logic
-- elsewhere in the app (e.g. any future report keyed off relationship =
-- 'self'). The dashboard UI already won't offer a Remove button for this
-- row, but this trigger is the same "never trust the client alone for
-- anything that gates access" principle used throughout this project
-- (see e.g. src/app/api/doctors/register/route.ts's own comments) —
-- applied here at the database level rather than only in the browser.
create or replace function public.prevent_archiving_self_family_member()
returns trigger
language plpgsql
as $$
begin
  if new.relationship = 'self' and new.archived_at is not null and old.archived_at is null then
    raise exception 'The account holder''s own family member record cannot be removed.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_archiving_self on public.family_members;
create trigger trg_prevent_archiving_self
  before update on public.family_members
  for each row execute procedure public.prevent_archiving_self_family_member();
