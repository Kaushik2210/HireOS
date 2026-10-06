-- Candidate profile (one row per user) and career goals (one row per user).
-- All rows are private to their owner through Row Level Security.

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 100),
  headline text check (headline is null or char_length(headline) <= 150),
  summary text check (summary is null or char_length(summary) <= 1500),
  location text check (location is null or char_length(location) <= 150),
  linkedin_url text check (linkedin_url is null or linkedin_url ~* '^https?://[^[:space:]]+$'),
  github_url text check (github_url is null or github_url ~* '^https?://[^[:space:]]+$'),
  website_url text check (website_url is null or website_url ~* '^https?://[^[:space:]]+$'),
  experience_level text check (experience_level in ('student','entry','junior','mid','senior','lead')),
  work_modes text[] not null default '{}' check (cardinality(work_modes) <= 3 and work_modes <@ array['remote','hybrid','onsite']),
  job_types text[] not null default '{}' check (cardinality(job_types) <= 4 and job_types <@ array['full_time','internship','contract','part_time']),
  preferred_locations text[] not null default '{}' check (cardinality(preferred_locations) <= 10),
  open_to_relocate boolean not null default false,
  expected_salary_min integer check (expected_salary_min is null or expected_salary_min >= 0),
  expected_salary_max integer check (expected_salary_max is null or expected_salary_max >= 0),
  salary_currency text not null default 'INR' check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period text not null default 'year' check (salary_period in ('year','month')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_salary_min is null or expected_salary_max is null or expected_salary_max >= expected_salary_min)
);


create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete_own on public.profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.profiles from anon, authenticated;
grant select, delete on public.profiles to authenticated;
grant insert (user_id, full_name, headline, summary, location, linkedin_url, github_url, website_url, experience_level, work_modes, job_types, preferred_locations, open_to_relocate, expected_salary_min, expected_salary_max, salary_currency, salary_period) on public.profiles to authenticated;
grant update (full_name, headline, summary, location, linkedin_url, github_url, website_url, experience_level, work_modes, job_types, preferred_locations, open_to_relocate, expected_salary_min, expected_salary_max, salary_currency, salary_period) on public.profiles to authenticated;
grant all on public.profiles to service_role;

create table public.career_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  target_roles text[] not null default '{}' check (cardinality(target_roles) <= 5),
  target_level text check (target_level in ('student','entry','junior','mid','senior','lead')),
  timeline_months integer check (timeline_months is null or timeline_months between 1 and 120),
  statement text check (statement is null or char_length(statement) <= 1000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create trigger career_goals_set_updated_at
  before update on public.career_goals
  for each row execute function public.set_updated_at();

alter table public.career_goals enable row level security;

create policy career_goals_select_own on public.career_goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy career_goals_insert_own on public.career_goals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy career_goals_update_own on public.career_goals
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy career_goals_delete_own on public.career_goals
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.career_goals from anon, authenticated;
grant select, delete on public.career_goals to authenticated;
grant insert (user_id, target_roles, target_level, timeline_months, statement) on public.career_goals to authenticated;
grant update (target_roles, target_level, timeline_months, statement) on public.career_goals to authenticated;
grant all on public.career_goals to service_role;
