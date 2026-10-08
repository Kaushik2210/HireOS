-- Interview preparation.
--   interviews     a round for an application: when, who, notes and a prep checklist
--   mock_sessions  a practice session: the questions chosen, and the result when finished
--   mock_answers   one written answer per question, with its feedback (never edited)
-- Practice is private to the user. Nothing here is shared, and nothing is scored by a model.

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  round_label text not null check (char_length(round_label) between 1 and 100),
  kind text not null check (
    kind in ('phone_screen', 'technical', 'behavioral', 'system_design', 'hr', 'final', 'other')
  ),
  format text check (format is null or format in ('video', 'phone', 'onsite', 'take_home')),
  -- The person's own wall-clock date and time. No time zone is stored or assumed.
  scheduled_on date,
  scheduled_time time,
  interviewer text check (interviewer is null or char_length(interviewer) between 1 and 150),
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  checklist jsonb not null default '[]'::jsonb check (
    jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 30
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_time is null or scheduled_on is not null)
);

create index interviews_user_idx on public.interviews (user_id, scheduled_on);
create index interviews_application_idx on public.interviews (application_id);

create trigger interviews_set_updated_at
  before update on public.interviews
  for each row execute function public.set_updated_at();

create function public.guard_interviews()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.interviews where user_id = new.user_id) >= 200 then
    raise exception 'interview limit reached';
  end if;
  return new;
end;
$$;

create trigger interviews_guard
  before insert on public.interviews
  for each row execute function public.guard_interviews();

create table public.mock_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept when the job is deleted, so past practice is not lost; the title is copied.
  job_id uuid references public.jobs (id) on delete set null,
  job_title text not null check (char_length(job_title) between 1 and 200),
  company_name text not null check (char_length(company_name) between 1 and 150),
  focus text not null check (focus in ('technical', 'behavioral', 'screen', 'final')),
  question_count integer not null check (question_count between 3 and 10),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  -- Which practice round this is for the job, so a repeat covers different questions.
  round integer not null default 0 check (round >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  overall integer check (overall is null or overall between 0 and 100),
  dimensions jsonb check (dimensions is null or jsonb_typeof(dimensions) = 'array'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_array_length(questions) = question_count),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'completed') = (overall is not null))
);

create index mock_sessions_user_idx on public.mock_sessions (user_id, created_at desc);
create index mock_sessions_job_idx on public.mock_sessions (job_id);

create table public.mock_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.mock_sessions (id) on delete cascade,
  position integer not null check (position between 0 and 9),
  -- The question as it was asked, copied so later changes to the bank cannot alter history.
  question jsonb not null check (jsonb_typeof(question) = 'object'),
  answer text not null check (char_length(answer) between 1 and 3000),
  feedback jsonb not null check (jsonb_typeof(feedback) = 'object'),
  overall integer not null check (overall between 0 and 100),
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create index mock_answers_session_idx on public.mock_answers (session_id, position);

-- Sessions: a cap per user, and a finished session is final. Finishing needs every question
-- answered, and the overall score must be the average of the answers' scores.
create function public.guard_mock_sessions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  answered integer;
  average numeric;
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.mock_sessions where user_id = new.user_id) >= 200 then
      raise exception 'practice session limit reached';
    end if;
    return new;
  end if;
  if old.status = 'completed' then
    raise exception 'finished sessions cannot change';
  end if;
  if new.status = 'completed' then
    select count(*), avg(overall) into answered, average
      from public.mock_answers where session_id = new.id;
    if answered <> new.question_count then
      raise exception 'answer every question before finishing';
    end if;
    if new.overall is distinct from round(average)::integer then
      raise exception 'the overall score must be the average of the answers';
    end if;
  end if;
  return new;
end;
$$;

create trigger mock_sessions_guard
  before insert or update on public.mock_sessions
  for each row execute function public.guard_mock_sessions();

-- Answers: in order, only for an unfinished session, within the number of questions.
create function public.guard_mock_answers()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  s record;
  answered integer;
begin
  select question_count, status into s from public.mock_sessions where id = new.session_id;
  if not found or s.status <> 'in_progress' then
    raise exception 'this session is not open for answers';
  end if;
  select count(*) into answered from public.mock_answers where session_id = new.session_id;
  if new.position <> answered or new.position >= s.question_count then
    raise exception 'answers must be given in order';
  end if;
  return new;
end;
$$;

create trigger mock_answers_guard
  before insert on public.mock_answers
  for each row execute function public.guard_mock_answers();

create function public.mock_answers_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'answers cannot be changed';
end;
$$;

create trigger mock_answers_no_update
  before update on public.mock_answers
  for each row execute function public.mock_answers_append_only();

alter table public.interviews enable row level security;
alter table public.mock_sessions enable row level security;
alter table public.mock_answers enable row level security;

create policy interviews_select_own on public.interviews
  for select to authenticated using (user_id = (select auth.uid()));

-- An interview belongs to one of the user's own applications (applications are themselves private).
create policy interviews_insert_own on public.interviews
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.applications a where a.id = application_id)
  );

create policy interviews_update_own on public.interviews
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy interviews_delete_own on public.interviews
  for delete to authenticated using (user_id = (select auth.uid()));

create policy mock_sessions_select_own on public.mock_sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy mock_sessions_insert_own on public.mock_sessions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'in_progress'
    and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id))
  );

create policy mock_sessions_update_own on public.mock_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy mock_sessions_delete_own on public.mock_sessions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy mock_answers_select_own on public.mock_answers
  for select to authenticated using (user_id = (select auth.uid()));

create policy mock_answers_insert_own on public.mock_answers
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.mock_sessions s
       where s.id = session_id and s.user_id = (select auth.uid()) and s.status = 'in_progress'
    )
  );

revoke all on public.interviews from anon, authenticated;
revoke all on public.mock_sessions from anon, authenticated;
revoke all on public.mock_answers from anon, authenticated;

grant select, delete on public.interviews to authenticated;
grant insert (
  user_id, application_id, round_label, kind, format, scheduled_on, scheduled_time,
  interviewer, notes, checklist
) on public.interviews to authenticated;
-- Which application a round belongs to never changes.
grant update (
  round_label, kind, format, scheduled_on, scheduled_time, interviewer, notes, status, checklist
) on public.interviews to authenticated;

grant select, delete on public.mock_sessions to authenticated;
grant insert (
  user_id, job_id, job_title, company_name, focus, question_count, questions, round
) on public.mock_sessions to authenticated;
grant update (status, completed_at, overall, dimensions) on public.mock_sessions to authenticated;

grant select on public.mock_answers to authenticated;
grant insert (user_id, session_id, position, question, answer, feedback, overall)
  on public.mock_answers to authenticated;

grant all on public.interviews to service_role;
grant all on public.mock_sessions to service_role;
grant all on public.mock_answers to service_role;
