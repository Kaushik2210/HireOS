-- App-level user record, one row per auth.users row.
-- Holds settings and onboarding state only. Email and credentials stay in Supabase Auth.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  onboarding_completed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Row Level Security: a user can read and edit only their own row.
alter table public.users enable row level security;

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select auth.uid()));

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert or delete policy for users: rows are created by the trigger below
-- and removed by the cascade from auth.users (account deletion).

-- Explicit grants, least privilege. Column-level update stops users changing id or is_demo.
revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (display_name, settings, onboarding_completed_at) on public.users to authenticated;
grant all on public.users to service_role;

-- Create the app row automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
