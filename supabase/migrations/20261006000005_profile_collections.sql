-- Profile collections. Every item carries a source and a confirmed flag:
--   source = 'manual'  typed by the user
--   source = 'resume'  proposed by the resume parser
-- Only confirmed items are verified, and only verified items may back generated claims.

create table public.education (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  institution text not null check (char_length(institution) between 1 and 150),
  degree text not null check (char_length(degree) between 1 and 150),
  field_of_study text check (field_of_study is null or char_length(field_of_study) <= 150),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  grade text check (grade is null or char_length(grade) <= 40),
  highlights text[] not null default '{}' check (cardinality(highlights) <= 10),
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (not (is_current and end_date is not null))
);

create index education_user_id_idx on public.education (user_id);

create trigger education_set_updated_at
  before update on public.education
  for each row execute function public.set_updated_at();

alter table public.education enable row level security;

create policy education_select_own on public.education
  for select to authenticated using (user_id = (select auth.uid()));
create policy education_insert_own on public.education
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy education_update_own on public.education
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy education_delete_own on public.education
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.education from anon, authenticated;
grant select, delete on public.education to authenticated;
grant insert (user_id, institution, degree, field_of_study, start_date, end_date, is_current, grade, highlights, source, confirmed) on public.education to authenticated;
grant update (institution, degree, field_of_study, start_date, end_date, is_current, grade, highlights, confirmed) on public.education to authenticated;
grant all on public.education to service_role;

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('work','internship','leadership','volunteer')),
  organization text not null check (char_length(organization) between 1 and 150),
  title text not null check (char_length(title) between 1 and 150),
  location text check (location is null or char_length(location) <= 150),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  highlights text[] not null default '{}' check (cardinality(highlights) <= 10),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (not (is_current and end_date is not null))
);

create index experiences_user_id_idx on public.experiences (user_id);

create trigger experiences_set_updated_at
  before update on public.experiences
  for each row execute function public.set_updated_at();

alter table public.experiences enable row level security;

create policy experiences_select_own on public.experiences
  for select to authenticated using (user_id = (select auth.uid()));
create policy experiences_insert_own on public.experiences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy experiences_update_own on public.experiences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy experiences_delete_own on public.experiences
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.experiences from anon, authenticated;
grant select, delete on public.experiences to authenticated;
grant insert (user_id, kind, organization, title, location, start_date, end_date, is_current, highlights, skills, source, confirmed) on public.experiences to authenticated;
grant update (kind, organization, title, location, start_date, end_date, is_current, highlights, skills, confirmed) on public.experiences to authenticated;
grant all on public.experiences to service_role;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 150),
  role text check (role is null or char_length(role) <= 150),
  description text check (description is null or char_length(description) <= 1000),
  url text check (url is null or url ~* '^https?://[^[:space:]]+$'),
  repo_url text check (repo_url is null or repo_url ~* '^https?://[^[:space:]]+$'),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  tech text[] not null default '{}' check (cardinality(tech) <= 30),
  highlights text[] not null default '{}' check (cardinality(highlights) <= 10),
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (not (is_current and end_date is not null))
);

create index projects_user_id_idx on public.projects (user_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy projects_select_own on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy projects_insert_own on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy projects_update_own on public.projects
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy projects_delete_own on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.projects from anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (user_id, name, role, description, url, repo_url, start_date, end_date, is_current, tech, highlights, source, confirmed) on public.projects to authenticated;
grant update (name, role, description, url, repo_url, start_date, end_date, is_current, tech, highlights, confirmed) on public.projects to authenticated;
grant all on public.projects to service_role;

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  issuer text check (issuer is null or char_length(issuer) <= 150),
  issued_date date,
  expires_date date,
  credential_id text check (credential_id is null or char_length(credential_id) <= 100),
  url text check (url is null or url ~* '^https?://[^[:space:]]+$'),
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_date is null or issued_date is null or expires_date >= issued_date)
);

create index certifications_user_id_idx on public.certifications (user_id);

create trigger certifications_set_updated_at
  before update on public.certifications
  for each row execute function public.set_updated_at();

alter table public.certifications enable row level security;

create policy certifications_select_own on public.certifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy certifications_insert_own on public.certifications
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy certifications_update_own on public.certifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy certifications_delete_own on public.certifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.certifications from anon, authenticated;
grant select, delete on public.certifications to authenticated;
grant insert (user_id, name, issuer, issued_date, expires_date, credential_id, url, source, confirmed) on public.certifications to authenticated;
grant update (name, issuer, issued_date, expires_date, credential_id, url, confirmed) on public.certifications to authenticated;
grant all on public.certifications to service_role;

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('language','framework','database','cloud_devops','data_ml','tool','soft','domain')),
  level text not null check (level in ('beginner','intermediate','advanced','expert')),
  years numeric(3,1) check (years is null or years between 0 and 50),
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index skills_user_id_idx on public.skills (user_id);
create unique index skills_user_id_name_key on public.skills (user_id, lower(name));

create trigger skills_set_updated_at
  before update on public.skills
  for each row execute function public.set_updated_at();

alter table public.skills enable row level security;

create policy skills_select_own on public.skills
  for select to authenticated using (user_id = (select auth.uid()));
create policy skills_insert_own on public.skills
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy skills_update_own on public.skills
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy skills_delete_own on public.skills
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.skills from anon, authenticated;
grant select, delete on public.skills to authenticated;
grant insert (user_id, name, type, level, years, source, confirmed) on public.skills to authenticated;
grant update (name, type, level, years, confirmed) on public.skills to authenticated;
grant all on public.skills to service_role;

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  category text not null check (category in ('award','competition','publication','other')),
  description text check (description is null or char_length(description) <= 1000),
  achieved_on date,
  source text not null default 'manual' check (source in ('manual', 'resume')),
  confirmed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index achievements_user_id_idx on public.achievements (user_id);

create trigger achievements_set_updated_at
  before update on public.achievements
  for each row execute function public.set_updated_at();

alter table public.achievements enable row level security;

create policy achievements_select_own on public.achievements
  for select to authenticated using (user_id = (select auth.uid()));
create policy achievements_insert_own on public.achievements
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy achievements_update_own on public.achievements
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy achievements_delete_own on public.achievements
  for delete to authenticated using (user_id = (select auth.uid()));

-- Least privilege: id, is_demo and timestamps are never client-writable; user_id is set on insert only.
revoke all on public.achievements from anon, authenticated;
grant select, delete on public.achievements to authenticated;
grant insert (user_id, title, category, description, achieved_on, source, confirmed) on public.achievements to authenticated;
grant update (title, category, description, achieved_on, confirmed) on public.achievements to authenticated;
grant all on public.achievements to service_role;
