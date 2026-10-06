-- Uploaded resumes: metadata, extracted text and the parse and health results.
-- The original file lives in the private `resumes` storage bucket (next migration).
-- Rows are immutable once written: re-analysis creates a new row.

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Display name only. Sanitised by the app; never used to build a storage path.
  file_name text not null check (char_length(file_name) between 1 and 120),
  content_type text not null check (
    content_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  -- SHA-256 of the file, used to recognise a re-upload of the same file.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Always {user_id}/{id}.{ext}, so a row can only point at its own owner's object.
  storage_path text not null,
  page_count integer not null default 1 check (page_count between 1 and 10),
  extracted_text text not null default '' check (char_length(extracted_text) <= 100000),
  parsed jsonb not null check (jsonb_typeof(parsed) = 'object'),
  health jsonb not null check (jsonb_typeof(health) = 'object'),
  parser_version smallint not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sha256),
  check (
    storage_path = user_id::text || '/' || id::text ||
      case content_type when 'application/pdf' then '.pdf' else '.docx' end
  )
);

create index resumes_user_id_created_at_idx on public.resumes (user_id, created_at desc);

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

alter table public.resumes enable row level security;

create policy resumes_select_own on public.resumes
  for select to authenticated using (user_id = (select auth.uid()));
create policy resumes_insert_own on public.resumes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy resumes_delete_own on public.resumes
  for delete to authenticated using (user_id = (select auth.uid()));
-- No update policy: resumes are immutable.

revoke all on public.resumes from anon, authenticated;
grant select, delete on public.resumes to authenticated;
grant insert (
  id, user_id, file_name, content_type, size_bytes, sha256, storage_path,
  page_count, extracted_text, parsed, health, parser_version
) on public.resumes to authenticated;
grant all on public.resumes to service_role;
