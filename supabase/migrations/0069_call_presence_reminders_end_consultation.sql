-- 0069 (2026-10-11): call behaviour — "other person is waiting" signal,
-- appointment reminders, and End consultation wrap-up.
--
-- Purely additive. Nothing here changes any existing table's meaning,
-- policy, trigger or function:
--   * new columns on `consultations` (last-seen timestamps, outcome)
--   * new function  touch_call_presence()     — each side's heartbeat
--   * new function  end_consultation()        — the doctor's wrap-up
--   * new function  send_consultation_reminders() + a once-a-minute job
--   * new table     consultation_reminders_sent (so nobody is reminded twice)
--   * new trigger   notify_patient_of_outcome — email for advice / no-show
-- Every email path is fail-open (same pattern as 0039): if Resend, Vault
-- or pg_net is not ready, the failure is swallowed and the clinical
-- action itself always succeeds.
--
-- BEFORE RUNNING: in the Supabase dashboard go to Database -> Extensions
-- and make sure "pg_cron" is enabled (the reminders job needs it). If it
-- is not enabled, everything else in this file still works; only the
-- scheduled reminders are skipped, and you can re-run this file after
-- enabling it.

-- 1. Columns ---------------------------------------------------------------

alter table public.consultations
  add column if not exists patient_last_seen_at timestamptz,
  add column if not exists doctor_last_seen_at  timestamptz,
  add column if not exists outcome text,
  add column if not exists outcome_note text,
  add column if not exists ended_at timestamptz;

alter table public.consultations
  drop constraint if exists consultations_outcome_check;
alter table public.consultations
  add constraint consultations_outcome_check
  check (outcome is null or outcome in ('prescription', 'advice_only', 'follow_up', 'patient_no_show'));

-- No new UPDATE grants on purpose: these columns are only ever written by
-- the security-definer functions below, never directly by a browser.

-- 2. Heartbeat: "I have the call page open" ----------------------------------
-- Called every ~30 seconds from each person's call page. The other side
-- treats someone as "waiting" if their last-seen time is under ~90
-- seconds old. Only the consultation's own patient account holder or its
-- assigned doctor can touch their own side.

create or replace function public.touch_call_presence(p_consultation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_patient boolean;
  v_is_doctor boolean;
begin
  select exists (
           select 1 from public.consultations c
           join public.family_members fm on fm.id = c.patient_id
           where c.id = p_consultation_id and fm.account_id = auth.uid()
         ),
         exists (
           select 1 from public.consultations c
           where c.id = p_consultation_id and c.doctor_id = auth.uid()
         )
    into v_is_patient, v_is_doctor;

  if v_is_doctor then
    update public.consultations set doctor_last_seen_at = now() where id = p_consultation_id;
  elsif v_is_patient then
    update public.consultations set patient_last_seen_at = now() where id = p_consultation_id;
  end if;
end;
$$;

revoke all on function public.touch_call_presence(uuid) from public, anon;
grant execute on function public.touch_call_presence(uuid) to authenticated;

-- 3. End consultation ---------------------------------------------------------
-- The doctor's wrap-up. "Write prescription" is NOT here: that already
-- completes the consultation by itself when the prescription is issued
-- (0018). This covers the other three endings.
--
-- A patient who did not attend is recorded as COMPLETED with outcome
-- 'patient_no_show' (the doctor's slot was held and used), so the
-- existing earnings/payout logic treats it like any finished visit.
-- Refunds, if you ever choose to give one, remain a manual admin action.

create or replace function public.end_consultation(
  p_consultation_id uuid,
  p_outcome text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_doctor uuid;
  v_note text := nullif(trim(p_note), '');
begin
  if p_outcome not in ('advice_only', 'follow_up', 'patient_no_show') then
    raise exception 'Unknown outcome.';
  end if;

  select c.status, c.doctor_id into v_status, v_doctor
  from public.consultations c
  where c.id = p_consultation_id;

  if v_status is null then
    raise exception 'Consultation not found.';
  end if;
  if v_doctor is distinct from auth.uid() then
    raise exception 'Only the assigned doctor can end this consultation.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'This consultation is not open (status: %).', v_status;
  end if;
  if p_outcome = 'advice_only' and v_note is null then
    raise exception 'Please write the advice for the patient.';
  end if;

  update public.consultations
  set status = 'completed',
      outcome = p_outcome,
      outcome_note = v_note,
      ended_at = now()
  where id = p_consultation_id;
end;
$$;

revoke all on function public.end_consultation(uuid, text, text) from public, anon;
grant execute on function public.end_consultation(uuid, text, text) to authenticated;

-- 4. Patient email when the doctor ends with advice / no-show ------------------

create or replace function public.notify_patient_of_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  v_site_url text;
  v_email text;
  v_name text;
  v_subject text;
  v_body text;
  v_link text;
begin
  if not (new.outcome in ('advice_only', 'patient_no_show') and old.outcome is distinct from new.outcome) then
    return new;
  end if;

  begin
    select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    if api_key is null or api_key = '' then
      return new;
    end if;

    select u.email, fm.full_name into v_email, v_name
    from public.family_members fm
    join auth.users u on u.id = fm.account_id
    where fm.id = new.patient_id;
    if v_email is null then
      return new;
    end if;

    select decrypted_secret into v_site_url from vault.decrypted_secrets where name = 'site_base_url' limit 1;
    v_link := case when coalesce(v_site_url, '') <> ''
                   then rtrim(v_site_url, '/') || '/dashboard'
                   else 'Log in to your Family Medic account.' end;

    if new.outcome = 'advice_only' then
      v_subject := 'Your doctor has finished your consultation';
      v_body := 'Your doctor has completed ' || coalesce(v_name, 'your') || '''s consultation and left you this advice:'
                || chr(10) || chr(10) || coalesce(new.outcome_note, '') || chr(10) || chr(10) || v_link;
    else
      v_subject := 'You missed your consultation';
      v_body := 'Your doctor was ready for ' || coalesce(v_name, 'your') || '''s consultation but could not reach you at the booked time, so it has been closed.'
                || chr(10) || chr(10) || 'If something came up, please contact the clinic and we will help you. ' || v_link;
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'Family Medic <contact@thefamilymedic.com>',
        'to', jsonb_build_array(v_email),
        'subject', v_subject,
        'text', v_body
      )
    );
  exception when others then
    raise warning 'notify_patient_of_outcome: email failed, consultation still closed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_consultation_outcome_notify_patient on public.consultations;
create trigger on_consultation_outcome_notify_patient
  after update of outcome on public.consultations
  for each row execute function public.notify_patient_of_outcome();

-- 5. Appointment reminders ----------------------------------------------------

create table if not exists public.consultation_reminders_sent (
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  kind text not null check (kind in ('1h', '10m')),
  sent_at timestamptz not null default now(),
  primary key (consultation_id, kind)
);
alter table public.consultation_reminders_sent enable row level security;
-- No policies: nobody but the database itself reads or writes this table.

create or replace function public.send_consultation_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key text;
  v_site_url text;
  r record;
  v_kind text;
  v_mins int;
  v_when text;
  v_link text;
  v_sent int := 0;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if api_key is null or api_key = '' then
    return 0;
  end if;
  select decrypted_secret into v_site_url from vault.decrypted_secrets where name = 'site_base_url' limit 1;

  for r in
    select c.id, c.created_at, c.delivery_mode, c.complaint, c.doctor_id,
           s.start_time,
           fm.full_name as patient_name,
           pu.email as patient_email,
           du.email as doctor_email,
           greatest(0, ceil(extract(epoch from (s.start_time - now())) / 60.0))::int as mins_left
    from public.consultations c
    join public.doctor_availability_slots s on s.id = c.slot_id
    join public.family_members fm on fm.id = c.patient_id
    left join auth.users pu on pu.id = fm.account_id
    left join auth.users du on du.id = c.doctor_id
    where c.status = 'submitted'
      and c.delivery_mode <> 'text'
      and s.start_time > now() - interval '2 minutes'
      and s.start_time <= now() + interval '60 minutes'
  loop
    -- Pick which reminder is due. The 10-minute one wins when both are
    -- due; the 1-hour one is skipped for bookings made too close to the
    -- start time for "in about an hour" to be true.
    v_kind := null;
    if r.mins_left <= 10 and r.created_at <= r.start_time - interval '15 minutes' then
      v_kind := '10m';
    elsif r.mins_left > 10 and r.created_at <= r.start_time - interval '70 minutes' then
      v_kind := '1h';
    end if;
    continue when v_kind is null;

    -- Claim it first, so two overlapping runs can never both send.
    begin
      insert into public.consultation_reminders_sent (consultation_id, kind) values (r.id, v_kind);
    exception when unique_violation then
      continue;
    end;

    v_mins := r.mins_left;
    v_when := to_char(r.start_time at time zone 'Asia/Karachi', 'FMHH12:MI AM') || ' (Pakistan time)';
    v_link := case when coalesce(v_site_url, '') <> ''
                   then rtrim(v_site_url, '/') || '/dashboard'
                   else 'Log in to your Family Medic account to join.' end;

    begin
      if r.patient_email is not null then
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'Family Medic <contact@thefamilymedic.com>',
            'to', jsonb_build_array(r.patient_email),
            'subject', case when v_kind = '10m'
                            then 'Your consultation starts in about ' || v_mins || ' minutes'
                            else 'Reminder: your consultation is at ' || to_char(r.start_time at time zone 'Asia/Karachi', 'FMHH12:MI AM') end,
            'text', 'Your ' || r.delivery_mode || ' consultation' ||
                    case when r.patient_name is not null then ' for ' || r.patient_name else '' end ||
                    ' is at ' || v_when || '.' || chr(10) || chr(10) ||
                    'You can join from 10 minutes before the start time. ' || v_link
          )
        );
      end if;
      if r.doctor_email is not null then
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'Family Medic <contact@thefamilymedic.com>',
            'to', jsonb_build_array(r.doctor_email),
            'subject', case when v_kind = '10m'
                            then 'Patient consultation in about ' || v_mins || ' minutes'
                            else 'Reminder: consultation at ' || to_char(r.start_time at time zone 'Asia/Karachi', 'FMHH12:MI AM') end,
            'text', 'You have a ' || r.delivery_mode || ' consultation with ' || coalesce(r.patient_name, 'a patient') ||
                    ' (' || coalesce(r.complaint, 'no reason given') || ') at ' || v_when || '.' || chr(10) || chr(10) ||
                    'Open your queue to join: ' ||
                    case when coalesce(v_site_url, '') <> '' then rtrim(v_site_url, '/') || '/doctor/queue' else 'log in to your doctor account.' end
          )
        );
      end if;
      v_sent := v_sent + 1;
    exception when others then
      raise warning 'send_consultation_reminders: email failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.send_consultation_reminders() from public, anon, authenticated;

-- 6. Run the reminder job every minute (needs the pg_cron extension) ----------

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'Could not enable pg_cron automatically (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'consultation-reminders';
    perform cron.schedule('consultation-reminders', '* * * * *', 'select public.send_consultation_reminders()');
  else
    raise notice 'pg_cron is not enabled: reminders were NOT scheduled. Enable it under Database > Extensions, then run this file again.';
  end if;
end;
$$;
