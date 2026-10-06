-- Prescription "issued at" timestamp (2026-10-06).
--
-- 0018 added consultation_assessments.issued_at ("when" for the audit
-- trail) but nothing ever filled it in: the doctor's Approve & Issue
-- button only sets status = 'issued'. Result: the prescription PDF and the
-- patient's prescription page showed no issue date/time.
--
-- This sets issued_at automatically at the moment status becomes
-- 'issued' (only if it is still empty), and back-fills prescriptions that
-- were already issued using their last-updated time. Idempotent, and
-- harmless if the live database already sets it some other way.

create or replace function public.set_assessment_issued_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'issued' and new.issued_at is null then
    new.issued_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists before_assessment_set_issued_at on public.consultation_assessments;
create trigger before_assessment_set_issued_at
  before insert or update on public.consultation_assessments
  for each row execute function public.set_assessment_issued_at();

update public.consultation_assessments
   set issued_at = coalesce(updated_at, created_at)
 where status = 'issued' and issued_at is null;
