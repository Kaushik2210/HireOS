-- Minimal stand-in for the parts of Supabase that migrations depend on, so migrations
-- and RLS can be verified on a plain Postgres engine. It mirrors three things:
--   1. the auth.users table (only the columns migrations reference)
--   2. auth.uid(), which reads the caller id the way PostgREST sets it
--   3. the anon / authenticated / service_role roles (service_role bypasses RLS)
-- It does not replace testing against a real Supabase stack.

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
