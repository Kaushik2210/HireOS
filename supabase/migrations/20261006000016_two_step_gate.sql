-- Two-step sign-in, enforced by the database.
--
-- The app already treats an account with a confirmed authenticator as signed out until the
-- code has been entered. That alone leaves a gap: someone holding only the password can ask
-- Supabase for rows directly, with the public key and the first-level token the password
-- gives them, and never touch the app. This closes it where the data lives.
--
-- Every table that holds a person's data, and the private resume files, get a RESTRICTIVE
-- policy. Restrictive policies are ANDed with the existing ones, so nothing that already
-- decides who owns what is touched: this only adds "and the session has proved the second
-- step, if the account has one".
--
-- An account with no confirmed authenticator is unaffected. The service role bypasses row
-- level security as before.

create function public.second_step_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = (select auth.uid())
           and f.factor_type = 'totp'
           and f.status = 'verified'
      );
$$;

revoke all on function public.second_step_satisfied() from public, anon;
grant execute on function public.second_step_satisfied() to authenticated, service_role;

do $$
declare
  t text;
begin
  -- Shared reference data (job sources, companies, the table of allowed status moves) holds
  -- nothing personal and is left alone; rate_limits is not reachable by API roles at all.
  foreach t in array array[
    'users', 'audit_logs', 'profiles', 'career_goals', 'education', 'experiences', 'projects',
    'certifications', 'skills', 'achievements', 'resumes', 'jobs', 'job_matches',
    'document_versions', 'outreach_drafts', 'applications', 'application_events',
    'interviews', 'mock_sessions', 'mock_answers'
  ] loop
    execute format(
      'create policy two_step_gate on public.%I as restrictive for all to authenticated
         using ((select public.second_step_satisfied()))
         with check ((select public.second_step_satisfied()))',
      t
    );
  end loop;
end
$$;

-- The private resume files.
create policy resumes_two_step_gate on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'resumes' or (select public.second_step_satisfied()))
  with check (bucket_id <> 'resumes' or (select public.second_step_satisfied()));

-- The two functions that run with their owner's rights skip row level security, so they check
-- the second step themselves. (Their behaviour is otherwise exactly as before.)
create or replace function public.change_application_status(
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
  if not (select public.second_step_satisfied()) then
    raise exception 'second step required';
  end if;
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

create or replace function public.add_application_event(p_id uuid, p_kind text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.second_step_satisfied()) then
    raise exception 'second step required';
  end if;
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
