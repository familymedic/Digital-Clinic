-- Phase 7 / Section 16: follow-up fee control (requirement captured
-- 2026-09-10, scoped and built 2026-09-12). The physician decides,
-- per follow-up consultation, whether it's free or the standard fee —
-- not a fixed platform rule. Scoped with two decisions:
-- (1) the doctor marks this manually from the clinical workspace,
--     after the follow-up consultation is already booked normally —
--     the booking form itself is untouched;
-- (2) two states only for now — standard / waived. A custom amount is
--     deferred to Phase 10, once there's a real payment gateway to
--     apply it to; recording an arbitrary number with nothing to charge
--     it against would just be dead data until then.
-- Refund logic is explicitly NOT part of this: refunding requires a
-- real payment already collected through a gateway (Phase 10), and
-- nothing is charged through a gateway yet — see the blueprint's
-- 2026-09-12 refund-vs-waiver note.
--
-- One row per consultation that IS a follow-up (not one row per
-- consultation overall) — most consultations are not follow-ups at
-- all, so this is kept as its own table rather than two more nullable
-- columns on `consultations` itself. This also keeps the access
-- boundary clean: this is doctor-administrative data, so — like
-- `consultation_assessments` before it — there's a doctor-only
-- SELECT/INSERT/UPDATE policy and (deliberately, for now) no
-- patient-facing policy at all. Nothing here is charged or shown to
-- the patient yet; that arrives with Phase 10's real payment/billing
-- surface.

create table if not exists public.consultation_followups (
  id uuid primary key default gen_random_uuid(),
  -- The follow-up consultation itself — one follow-up designation per
  -- consultation, hence unique.
  consultation_id uuid not null unique references public.consultations (id) on delete cascade,
  -- The earlier consultation this one follows up on.
  follow_up_to uuid not null references public.consultations (id) on delete cascade,
  fee_status text not null default 'standard' check (fee_status in ('standard', 'waived')),
  doctor_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_followups_not_self check (consultation_id <> follow_up_to)
);

alter table public.consultation_followups enable row level security;

drop policy if exists "Doctors can view their own follow-up links" on public.consultation_followups;
create policy "Doctors can view their own follow-up links"
  on public.consultation_followups for select
  using (doctor_id = auth.uid());

-- INSERT/UPDATE both re-check, via the actual consultations table,
-- that BOTH ends of the link (the follow-up consultation and the one
-- it follows up on) really belong to the doctor making the change —
-- storing doctor_id directly on this row is a convenience for the
-- simple SELECT policy above, not something the writer gets to assert
-- unchecked. `consultations` is not one of the tables whose own policy
-- references `consultation_followups`, so this carries no recursion
-- risk (the same reasoning already documented in 0016).
drop policy if exists "Doctors can create follow-up links for their consultations" on public.consultation_followups;
create policy "Doctors can create follow-up links for their consultations"
  on public.consultation_followups for insert
  with check (
    doctor_id = auth.uid()
    and exists (select 1 from public.consultations where id = consultation_id and doctor_id = auth.uid())
    and exists (select 1 from public.consultations where id = follow_up_to and doctor_id = auth.uid())
  );

drop policy if exists "Doctors can update follow-up links for their consultations" on public.consultation_followups;
create policy "Doctors can update follow-up links for their consultations"
  on public.consultation_followups for update
  using (doctor_id = auth.uid())
  with check (
    doctor_id = auth.uid()
    and exists (select 1 from public.consultations where id = consultation_id and doctor_id = auth.uid())
    and exists (select 1 from public.consultations where id = follow_up_to and doctor_id = auth.uid())
  );

-- No patient-facing policy yet, and no DELETE policy either — a
-- follow-up link, once set, is edited (re-pick the original
-- consultation, or flip standard/waived), not removed; nothing in the
-- app offers a delete path.
