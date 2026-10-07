-- Tailored resumes and cover letters, saved as numbered versions per user and job.
-- A version is a snapshot: its content never changes after it is saved. The only change
-- allowed is approving a draft, and only when the integrity check passed. Approving is the
-- user's explicit review step; nothing here sends anything anywhere.

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('resume', 'cover_letter')),
  version_number integer not null check (version_number >= 1),
  parent_id uuid references public.document_versions (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  -- The document with every claim and the item it came from.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  -- Result of the integrity check at save time.
  verification jsonb not null check (
    jsonb_typeof(verification) = 'object'
    and coalesce((verification ->> 'ok') in ('true', 'false'), false)
  ),
  -- The document as plain text, for display, comparison and export.
  body text not null check (char_length(body) between 1 and 20000),
  tailor_version integer not null check (tailor_version >= 1),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (user_id, job_id, kind, version_number),
  check ((status = 'approved') = (approved_at is not null)),
  -- A document with a blocked claim can never be approved.
  check (status <> 'approved' or (verification ->> 'ok') = 'true')
);

create index document_versions_user_idx on public.document_versions (user_id, created_at desc);
create index document_versions_job_idx on public.document_versions (job_id);
create index document_versions_parent_idx on public.document_versions (parent_id);

create function public.guard_document_versions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.document_versions where user_id = new.user_id) >= 200 then
      raise exception 'document version limit reached';
    end if;
    return new;
  end if;
  -- UPDATE: approved versions are final.
  if old.status = 'approved' then
    raise exception 'approved versions cannot change';
  end if;
  return new;
end;
$$;

create trigger document_versions_guard
  before insert or update on public.document_versions
  for each row execute function public.guard_document_versions();

-- Used by the insert policy. A policy that reads its own table would recurse, so the
-- ownership lookup runs with the function owner's rights. It answers only "is this version
-- mine?" for the calling user and returns nothing else.
create function public.owns_document_version(version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.document_versions
    where id = version_id and user_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_document_version(uuid) from public;
grant execute on function public.owns_document_version(uuid) to authenticated, service_role;

alter table public.document_versions enable row level security;

create policy document_versions_select_own on public.document_versions
  for select to authenticated using (user_id = (select auth.uid()));

-- A version can only be saved against a job the user can see, and can only descend from
-- one of their own versions.
create policy document_versions_insert_own on public.document_versions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.jobs j where j.id = job_id)
    and (parent_id is null or public.owns_document_version(parent_id))
  );

create policy document_versions_update_own on public.document_versions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy document_versions_delete_own on public.document_versions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.document_versions from anon, authenticated;
grant select, delete on public.document_versions to authenticated;
grant insert (
  user_id, job_id, kind, version_number, parent_id, content, changes, missing,
  verification, body, tailor_version, profile_hash
) on public.document_versions to authenticated;
-- Only the review decision can change after saving.
grant update (status, approved_at) on public.document_versions to authenticated;
grant all on public.document_versions to service_role;
