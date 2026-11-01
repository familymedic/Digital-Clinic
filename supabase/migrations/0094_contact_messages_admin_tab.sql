-- 0094 Admin "Contact messages" tab (2026-10-29, Zayn: "cant we see the msgs at Admin tab?").
-- Requires 0045 (contact_messages table). Only makes sure the admin tab can read and mark
-- messages: the status column and the admin-only select/update policies. Idempotent and
-- safe to run if 0045 already created them. No change to who can SEND a message.
alter table public.contact_messages
  add column if not exists status text not null default 'new';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contact_messages'::regclass
      and conname = 'contact_messages_status_check'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contact_messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_status_check check (status in ('new', 'read', 'archived'));
  end if;
end $$;

drop policy if exists "Admins can view contact messages" on public.contact_messages;
create policy "Admins can view contact messages"
  on public.contact_messages for select
  using (exists (select 1 from public.admin_profiles where id = auth.uid()));

drop policy if exists "Admins can update contact messages" on public.contact_messages;
create policy "Admins can update contact messages"
  on public.contact_messages for update
  using (exists (select 1 from public.admin_profiles where id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles where id = auth.uid()));
