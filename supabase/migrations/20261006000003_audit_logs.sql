-- Append-only record of security-relevant events.
-- Stores the action, the user id, and small non-sensitive metadata. Never emails,
-- passwords, tokens, or resume content.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- Kept after account deletion with the user detached, so history survives without PII.
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_user_id_created_at_idx on public.audit_logs (user_id, created_at desc);

alter table public.audit_logs enable row level security;

-- Users can read their own trail. Nobody but the service role can write.
create policy audit_logs_select_own on public.audit_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert on public.audit_logs to service_role;

-- Enforce append-only for every role, including the table owner and service role.
-- The single permitted change is detaching the user when an account is deleted.
create or replace function public.audit_logs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_logs is append-only';
  end if;

  if new.user_id is not null
     or new.id is distinct from old.id
     or new.action is distinct from old.action
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at then
    raise exception 'audit_logs is append-only';
  end if;

  return new;
end;
$$;

create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.audit_logs_guard();

create trigger audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.audit_logs_guard();
