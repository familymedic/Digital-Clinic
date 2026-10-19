-- Public doctor ratings (2026-10-19).
--
-- Reuses the existing patient_feedback table (0026) instead of adding a
-- second review table: a "review" row that is tied to a COMPLETED
-- consultation now counts towards that doctor's public star rating.
--
-- Privacy and trust rules (decided with the physician):
--   * Reviewers are never named publicly - the public views below carry no
--     account, name or phone at all. The site labels them "Verified patient".
--   * Only the patient who actually had the consultation can review it, once,
--     and only after it is completed (enforced by the trigger below, so it
--     cannot be bypassed by calling the API directly).
--   * The star rating counts immediately. A written comment stays private
--     until an admin approves it (comment_status).
--   * An admin can hide a rating from the public average (rating_hidden).
--   * Complaints (kind = 'complaint') are never public.
--
-- Fully additive and safe to run on a live database. The site keeps working
-- before this is run (stars simply do not appear yet).

-- 1. Moderation columns.
alter table public.patient_feedback
  add column if not exists comment_status text not null default 'none',
  add column if not exists rating_hidden boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.patient_feedback'::regclass
      and conname = 'patient_feedback_comment_status_check'
  ) then
    alter table public.patient_feedback
      add constraint patient_feedback_comment_status_check
      check (comment_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

-- 2. Integrity trigger: a review that points at a consultation must belong
--    to the person submitting it, be completed, and be the only one.
--    It also stamps the doctor from the consultation (never trusts the
--    client) and resets the moderation fields so a patient can never
--    approve their own comment.
create or replace function public.patient_feedback_before_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c record;
begin
  -- Never let the submitter choose moderation state.
  new.rating_hidden := false;
  new.comment_status := 'none';

  if new.kind = 'review' and new.consultation_id is not null then
    select co.id, co.doctor_id, co.status, fm.account_id
      into c
      from public.consultations co
      join public.family_members fm on fm.id = co.patient_id
     where co.id = new.consultation_id;

    if not found or c.account_id is distinct from new.account_id then
      raise exception 'You can only review your own consultation.';
    end if;
    if c.status <> 'completed' then
      raise exception 'You can review a consultation once it is completed.';
    end if;
    if exists (
      select 1 from public.patient_feedback pf
       where pf.kind = 'review'
         and pf.consultation_id = new.consultation_id
    ) then
      raise exception 'You have already reviewed this consultation.';
    end if;

    new.doctor_id := c.doctor_id;
    if new.rating is null then
      raise exception 'Please choose a star rating.';
    end if;
    if nullif(btrim(coalesce(new.message, '')), '') is not null then
      new.comment_status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists patient_feedback_before_insert on public.patient_feedback;
create trigger patient_feedback_before_insert
  before insert on public.patient_feedback
  for each row execute function public.patient_feedback_before_insert();

-- 3. Public star summary per doctor. Counts one rating per consultation,
--    only for completed consultations, skipping any an admin hid.
create or replace view public.doctor_rating_summary as
select
  co.doctor_id,
  round(avg(r.rating)::numeric, 1) as avg_rating,
  count(*)::int as review_count
from (
  select distinct on (pf.consultation_id)
         pf.consultation_id, pf.rating
    from public.patient_feedback pf
   where pf.kind = 'review'
     and pf.consultation_id is not null
     and pf.rating between 1 and 5
     and not pf.rating_hidden
   order by pf.consultation_id, pf.created_at desc
) r
join public.consultations co on co.id = r.consultation_id
where co.doctor_id is not null
  and co.status = 'completed'
group by co.doctor_id;

grant select on public.doctor_rating_summary to anon, authenticated;

-- 4. Public written reviews: approved comments only, no identity at all.
create or replace view public.public_doctor_reviews as
select
  pf.id,
  co.doctor_id,
  pf.rating,
  pf.message,
  pf.created_at
from public.patient_feedback pf
join public.consultations co on co.id = pf.consultation_id
where pf.kind = 'review'
  and pf.comment_status = 'approved'
  and not pf.rating_hidden
  and pf.rating between 1 and 5
  and nullif(btrim(coalesce(pf.message, '')), '') is not null
  and co.doctor_id is not null
  and co.status = 'completed';

grant select on public.public_doctor_reviews to anon, authenticated;

-- 5. A patient can see whether they already reviewed a consultation
--    (the existing "view own feedback" policy from 0026 already allows
--    this); admins already have the update policy used for moderation.
