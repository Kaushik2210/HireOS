-- Job catalogue.
--   job_sources  reference data: where jobs come from, and on what basis
--   companies    shared company records for ingested jobs
--   jobs         one row per posting. owner_user_id is null for the shared catalogue
--                (written only by the service role) or a user's id for a job they pasted in
--                themselves (private to them).
-- search_jobs() runs with the caller's rights, so Row Level Security decides which jobs
-- appear in every search.

create table public.job_sources (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('demo', 'feed', 'manual')),
  -- The stated basis for fetching from this source. Required reading before enabling one.
  terms_note text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.job_sources enable row level security;
create policy job_sources_select_all on public.job_sources
  for select to authenticated using (true);
revoke all on public.job_sources from anon, authenticated;
grant select on public.job_sources to authenticated;
grant all on public.job_sources to service_role;

insert into public.job_sources (key, name, kind, terms_note) values
  ('demo', 'Demo Careers Board', 'demo', 'Fictional data bundled with HireOS. No network access.'),
  ('demo-aggregator', 'Demo Job Aggregator', 'demo', 'Fictional data bundled with HireOS. No network access.'),
  ('manual', 'Added by you', 'manual', 'Text the user pasted in. Nothing is fetched.');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 150),
  website text check (website is null or website ~* '^https?://[^[:space:]]+$'),
  industry text check (industry is null or char_length(industry) <= 80),
  size_band text check (size_band is null or char_length(size_band) <= 20),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
create policy companies_select_all on public.companies
  for select to authenticated using (true);
revoke all on public.companies from anon, authenticated;
grant select on public.companies to authenticated;
grant all on public.companies to service_role;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  company_name text not null check (char_length(company_name) between 1 and 150),
  source_key text not null references public.job_sources (key),
  external_id text check (external_id is null or char_length(external_id) <= 200),
  -- Identity of the posting across sources (see lib/jobs/keys.ts).
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 200),
  location text check (location is null or char_length(location) <= 150),
  work_mode text check (work_mode in ('remote', 'hybrid', 'onsite')),
  job_type text check (job_type in ('full_time', 'internship', 'contract', 'part_time')),
  seniority text check (seniority in ('student', 'entry', 'junior', 'mid', 'senior', 'lead')),
  salary_min integer check (salary_min is null or salary_min >= 0),
  salary_max integer check (salary_max is null or salary_max >= 0),
  salary_currency text check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  salary_period text check (salary_period in ('year', 'month')),
  description text not null check (char_length(description) between 1 and 20000),
  requirements text[] not null default '{}' check (cardinality(requirements) <= 30),
  responsibilities text[] not null default '{}' check (cardinality(responsibilities) <= 30),
  required_skills text[] not null default '{}' check (cardinality(required_skills) <= 40),
  preferred_skills text[] not null default '{}' check (cardinality(preferred_skills) <= 40),
  min_years numeric(3, 1) check (min_years is null or min_years between 0 and 40),
  apply_url text check (apply_url is null or apply_url ~* '^https?://[^[:space:]]+$'),
  posted_at date,
  also_listed_on jsonb not null default '[]'::jsonb check (jsonb_typeof(also_listed_on) = 'array'),
  is_demo boolean not null default false,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_max >= salary_min),
  check ((salary_min is null and salary_max is null) or salary_currency is not null),
  -- A private job can only be a manual one, and never counts as demo data.
  check (owner_user_id is null or (source_key = 'manual' and is_demo = false))
);

-- Duplicate protection: one shared posting per fingerprint, and one per owner for private ones.
create unique index jobs_shared_fingerprint_key on public.jobs (fingerprint) where owner_user_id is null;
create unique index jobs_owner_fingerprint_key on public.jobs (owner_user_id, fingerprint) where owner_user_id is not null;
create index jobs_owner_idx on public.jobs (owner_user_id) where owner_user_id is not null;
create index jobs_posted_idx on public.jobs (posted_at desc nulls last, discovered_at desc);
create index jobs_company_id_idx on public.jobs (company_id);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Bound what one user can store, whatever the application does.
create function public.enforce_private_job_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_user_id is not null
     and (select count(*) from public.jobs where owner_user_id = new.owner_user_id) >= 100 then
    raise exception 'private job limit reached';
  end if;
  return new;
end;
$$;

create trigger jobs_private_limit
  before insert on public.jobs
  for each row execute function public.enforce_private_job_limit();

alter table public.jobs enable row level security;

create policy jobs_select_visible on public.jobs
  for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

create policy jobs_insert_own on public.jobs
  for insert to authenticated
  with check (
    owner_user_id = (select auth.uid()) and source_key = 'manual' and is_demo = false
  );

create policy jobs_delete_own on public.jobs
  for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- No update policy: a private job is deleted and re-added to change it.
revoke all on public.jobs from anon, authenticated;
grant select, delete on public.jobs to authenticated;
grant insert (
  owner_user_id, company_name, source_key, external_id, fingerprint, title, location,
  work_mode, job_type, seniority, salary_min, salary_max, salary_currency, salary_period,
  description, requirements, responsibilities, required_skills, preferred_skills,
  min_years, apply_url, posted_at
) on public.jobs to authenticated;
grant all on public.jobs to service_role;

-- Search with filters, sorting and paging in one call. A query matches when every word
-- appears (case-insensitively) somewhere in the title, company, location, skills or
-- description. security invoker: RLS applies, so users only ever see shared jobs and their own.
create function public.search_jobs(
  q text default null,
  modes text[] default null,
  types text[] default null,
  levels text[] default null,
  company text default null,
  only_with_salary boolean default false,
  hide_demo boolean default false,
  sort_by text default 'newest',
  page_size integer default 20,
  page_offset integer default 0
)
returns table (job jsonb, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select j.*
    from public.jobs j
    where (modes is null or cardinality(modes) = 0 or j.work_mode = any (modes))
      and (types is null or cardinality(types) = 0 or j.job_type = any (types))
      and (levels is null or cardinality(levels) = 0 or j.seniority = any (levels))
      and (company is null or company = '' or strpos(lower(j.company_name), lower(company)) > 0)
      and (not only_with_salary or j.salary_min is not null or j.salary_max is not null)
      and (not hide_demo or not j.is_demo)
      and (
        q is null
        or btrim(q) = ''
        or not exists (
          select 1
          from unnest(string_to_array(lower(btrim(q)), ' ')) as t(token)
          where token <> ''
            and strpos(
              lower(
                j.title || ' ' || j.company_name || ' ' || coalesce(j.location, '') || ' '
                || array_to_string(j.required_skills || j.preferred_skills, ' ') || ' ' || j.description
              ),
              token
            ) = 0
        )
      )
  )
  select to_jsonb(f) as job, count(*) over () as total
  from filtered f
  order by
    case when sort_by = 'title' then lower(f.title) end asc,
    case when sort_by = 'oldest' then coalesce(f.posted_at, f.discovered_at::date) end asc nulls last,
    case when sort_by not in ('title', 'oldest') then coalesce(f.posted_at, f.discovered_at::date) end desc nulls last,
    f.discovered_at desc,
    f.id
  limit least(greatest(page_size, 1), 100)
  offset greatest(page_offset, 0)
$$;

grant execute on function public.search_jobs(
  text, text[], text[], text[], text, boolean, boolean, text, integer, integer
) to authenticated, service_role;
