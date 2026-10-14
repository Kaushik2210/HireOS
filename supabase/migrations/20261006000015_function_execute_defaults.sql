-- Postgres lets everyone (PUBLIC, which includes the anonymous role) execute a new function
-- unless told otherwise. Close that door for the one function that was left open, and make
-- the default for functions created from now on "nobody until granted".

revoke execute on function public.search_jobs(
  text, text[], text[], text[], text, boolean, boolean, text, integer, integer
) from public, anon;

alter default privileges in schema public revoke execute on functions from public, anon;
