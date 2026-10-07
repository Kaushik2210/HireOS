-- Application pipeline: where each application stands, and an append-only history of how
-- it got there. A status is the person's own statement: HireOS never submits anything.
--   applications             one per user and job (history survives the job being deleted)
--   application_transitions  which moves are allowed (reference data, mirrored in the app)
--   application_events       append-only log, written only by triggers and functions
-- Status changes go through change_application_status(), which checks the move against the
-- transition table and writes the event in the same transaction. A trigger blocks every
-- other way of changing a status, for every role.

create table public.application_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.application_transitions (from_status, to_status) values
  ('discovered', 'shortlisted'), ('discovered', 'preparing'), ('discovered', 'withdrawn'),
  ('shortlisted', 'discovered'), ('shortlisted', 'preparing'), ('shortlisted', 'applied'),
  ('shortlisted', 'withdrawn'),
  ('preparing', 'shortlisted'), ('preparing', 'applied'), ('preparing', 'withdrawn'),
  ('applied', 'assessment'), ('applied', 'interview'), ('applied', 'rejected'),
  ('applied', 'withdrawn'), ('applied', 'no_response'),
  ('assessment', 'interview'), ('assessment', 'rejected'), ('assessment', 'withdrawn'),
  ('assessment', 'no_response'),
  ('interview', 'assessment'), ('interview', 'final_round'), ('interview', 'offer'),
  ('interview', 'rejected'), ('interview', 'withdrawn'), ('interview', 'no_response'),
  ('final_round', 'offer'), ('final_round', 'rejected'), ('final_round', 'withdrawn'),
  ('final_round', 'no_response'),
  ('offer', 'rejected'), ('offer', 'withdrawn'),
  ('withdrawn', 'shortlisted'),
  ('no_response', 'applied'), ('no_response', 'interview'), ('no_response', 'rejected'),
  ('no_response', 'withdrawn');

alter table public.application_transitions enable row level security;
create policy application_transitions_select_all on public.application_transitions
  for select to authenticated using (true);
revoke all on public.application_transitions from anon, authenticated;
grant select on public.application_transitions to authenticated;
grant all on public.application_transitions to service_role;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept when the job is deleted, so the history is not lost; the title and company are copied.
  job_id uuid references public.jobs (id) on delete set null,
  job_title text not null check (char_length(job_title) between 1 and 200),
  company_name text not null check (char_length(company_name) between 1 and 150),
  status text not null default 'discovered' check (
    status in ('discovered', 'shortlisted', 'preparing', 'applied', 'assessment', 'interview',
               'final_round', 'offer', 'rejected', 'withdrawn', 'no_response')
  ),
  applied_on date check (applied_on is null or applied_on <= current_date + 1),
  follow_up_on date,
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  resume_version_id uuid references public.document_versions (id) on delete set null,
  cover_letter_version_id uuid references public.document_versions (id) on delete set null,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Once applied (and until an outcome), the application date must be known.
  check (
    status not in ('applied', 'assessment', 'interview', 'final_round', 'offer')
    or applied_on is not null
  )
);

create unique index applications_user_job_key on public.applications (user_id, job_id)
  where job_id is not null;
create index applications_user_status_idx on public.applications (user_id, status);
create index applications_job_idx on public.applications (job_id);

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  kind text not null check (
    kind in ('created', 'status_changed', 'note', 'followed_up', 'follow_up_set', 'documents_linked')
  ),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  check ((kind = 'status_changed') = (from_status is not null)),
  check ((kind in ('created', 'status_changed')) = (to_status is not null))
);

create index application_events_app_idx on public.application_events (application_id, created_at);

-- The log is append-only: no update, for any role. Users also have no update or delete
-- grant; rows go away only when their application is deleted.
create function public.application_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'application events are append-only';
end;
$$;

create trigger application_events_no_update
  before update on public.application_events
  for each row execute function public.application_events_append_only();

create function public.guard_applications()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.applications where user_id = new.user_id) >= 500 then
      raise exception 'application limit reached';
    end if;
    return new;
  end if;
  -- UPDATE: a status or application date moves only through change_application_status().
  if (new.status is distinct from old.status or new.applied_on is distinct from old.applied_on)
     and coalesce(current_setting('hireos.allow_status_change', true), '') <> 'on' then
    raise exception 'status changes go through change_application_status';
  end if;
  return new;
end;
$$;

create trigger applications_guard
  before insert or update on public.applications
  for each row execute function public.guard_applications();

-- Writes the first event, and one when a follow-up date or linked documents change.
create function public.log_application_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (user_id, application_id, kind, to_status)
    values (new.user_id, new.id, 'created', new.status);
    return new;
  end if;
  if new.follow_up_on is distinct from old.follow_up_on then
    insert into public.application_events (user_id, application_id, kind, note)
    values (
      new.user_id, new.id, 'follow_up_set',
      case when new.follow_up_on is null then 'cleared' else new.follow_up_on::text end
    );
  end if;
  if new.resume_version_id is distinct from old.resume_version_id
     or new.cover_letter_version_id is distinct from old.cover_letter_version_id then
    insert into public.application_events (user_id, application_id, kind)
    values (new.user_id, new.id, 'documents_linked');
  end if;
  return new;
end;
$$;

create trigger applications_log
  after insert or update on public.applications
  for each row execute function public.log_application_changes();

create function public.change_application_status(
  p_id uuid,
  p_status text,
  p_note text default null,
  p_on date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.applications;
begin
  select * into cur from public.applications
   where id = p_id and user_id = (select auth.uid())
   for update;
  if not found then
    raise exception 'application not found';
  end if;
  if not exists (
    select 1 from public.application_transitions
     where from_status = cur.status and to_status = p_status
  ) then
    raise exception 'that move is not allowed from %', cur.status;
  end if;
  perform set_config('hireos.allow_status_change', 'on', true);
  update public.applications
     set status = p_status,
         status_changed_at = now(),
         applied_on = case
           when p_status = 'applied' then coalesce(p_on, applied_on, current_date)
           else applied_on
         end
   where id = p_id;
  perform set_config('hireos.allow_status_change', 'off', true);
  insert into public.application_events (user_id, application_id, kind, from_status, to_status, note)
  values (cur.user_id, p_id, 'status_changed', cur.status, p_status, nullif(trim(p_note), ''));
end;
$$;

create function public.add_application_event(p_id uuid, p_kind text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('note', 'followed_up') then
    raise exception 'that kind of event cannot be added';
  end if;
  if p_kind = 'note' and nullif(trim(p_note), '') is null then
    raise exception 'a note needs text';
  end if;
  if not exists (
    select 1 from public.applications where id = p_id and user_id = (select auth.uid())
  ) then
    raise exception 'application not found';
  end if;
  insert into public.application_events (user_id, application_id, kind, note)
  values ((select auth.uid()), p_id, p_kind, nullif(trim(p_note), ''));
end;
$$;

revoke all on function public.change_application_status(uuid, text, text, date) from public;
revoke all on function public.add_application_event(uuid, text, text) from public;
grant execute on function public.change_application_status(uuid, text, text, date)
  to authenticated, service_role;
grant execute on function public.add_application_event(uuid, text, text)
  to authenticated, service_role;

alter table public.applications enable row level security;
alter table public.application_events enable row level security;

create policy applications_select_own on public.applications
  for select to authenticated using (user_id = (select auth.uid()));

-- A new application starts early in the pipeline, for a job the user can see.
create policy applications_insert_own on public.applications
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status in ('discovered', 'shortlisted', 'preparing', 'applied')
    and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id))
  );

-- Linked documents must be the user's own.
create policy applications_update_own on public.applications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (resume_version_id is null or public.owns_document_version(resume_version_id))
    and (cover_letter_version_id is null or public.owns_document_version(cover_letter_version_id))
  );

create policy applications_delete_own on public.applications
  for delete to authenticated using (user_id = (select auth.uid()));

create policy application_events_select_own on public.application_events
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.applications from anon, authenticated;
revoke all on public.application_events from anon, authenticated;
grant select, delete on public.applications to authenticated;
grant insert (user_id, job_id, job_title, company_name, status, applied_on, notes, follow_up_on)
  on public.applications to authenticated;
-- Only the person's own working fields can be edited directly; the status never can.
grant update (notes, follow_up_on, resume_version_id, cover_letter_version_id)
  on public.applications to authenticated;
grant select on public.application_events to authenticated;
grant all on public.applications to service_role;
grant all on public.application_events to service_role;
