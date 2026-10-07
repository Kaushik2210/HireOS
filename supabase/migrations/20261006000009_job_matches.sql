-- Saved match results: the last Application Strength computed for a user and a job.
-- The score itself is always recomputed from the verified profile (deterministic); this
-- table is a snapshot so the UI can show what was computed and when, and so a changed
-- profile or scorer version can be detected through profile_hash and scorer_version.
-- Rows are private to their user.

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  scorer_version integer not null check (scorer_version >= 1),
  strength integer not null check (strength between 0 and 100),
  label text not null check (label in ('strong', 'good', 'stretch', 'low')),
  components jsonb not null check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) = 7),
  why jsonb not null check (jsonb_typeof(why) = 'array'),
  gaps jsonb not null check (jsonb_typeof(gaps) = 'array'),
  keywords jsonb not null check (jsonb_typeof(keywords) = 'object'),
  concerns jsonb not null check (jsonb_typeof(concerns) = 'array'),
  cap jsonb not null check (jsonb_typeof(cap) = 'object'),
  action jsonb not null check (jsonb_typeof(action) = 'object'),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  computed_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index job_matches_user_strength_idx on public.job_matches (user_id, strength desc);
create index job_matches_job_idx on public.job_matches (job_id);

-- Bound what one user can store, whatever the application does.
create function public.enforce_job_match_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.job_matches where user_id = new.user_id) >= 2000 then
    raise exception 'job match limit reached';
  end if;
  return new;
end;
$$;

create trigger job_matches_limit
  before insert on public.job_matches
  for each row execute function public.enforce_job_match_limit();

alter table public.job_matches enable row level security;

create policy job_matches_select_own on public.job_matches
  for select to authenticated using (user_id = (select auth.uid()));

-- A match can only be saved for a job the user can see.
create policy job_matches_insert_own on public.job_matches
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.jobs j where j.id = job_id)
  );

create policy job_matches_update_own on public.job_matches
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy job_matches_delete_own on public.job_matches
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.job_matches from anon, authenticated;
grant select, delete on public.job_matches to authenticated;
grant insert (
  user_id, job_id, scorer_version, strength, label, components, why, gaps, keywords,
  concerns, cap, action, profile_hash, computed_at
) on public.job_matches to authenticated;
grant update (
  scorer_version, strength, label, components, why, gaps, keywords, concerns, cap, action,
  profile_hash, computed_at
) on public.job_matches to authenticated;
grant all on public.job_matches to service_role;
