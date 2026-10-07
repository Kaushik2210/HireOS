-- Outreach drafts: words for an email or a LinkedIn note, written for the user to copy.
-- Nothing here connects to a mail service or to LinkedIn; "sent" is the user telling us they
-- sent it themselves. A draft can only be approved or marked sent when its integrity check
-- passed, and an approved or sent draft can no longer be edited.

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  type text not null check (
    type in ('recruiter', 'hiring_manager', 'referral', 'alumni', 'linkedin_note', 'follow_up', 'thank_you')
  ),
  channel text not null check (channel in ('email', 'linkedin')),
  recipient_name text check (recipient_name is null or char_length(recipient_name) between 1 and 100),
  recipient_title text check (recipient_title is null or char_length(recipient_title) between 1 and 100),
  shared_context text check (shared_context is null or char_length(shared_context) between 1 and 300),
  subject text check (subject is null or char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  -- The draft with every generated line and the item it came from.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  verification jsonb not null check (
    jsonb_typeof(verification) = 'object'
    and coalesce((verification ->> 'ok') in ('true', 'false'), false)
  ),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  tailor_version integer not null check (tailor_version >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  -- A LinkedIn note is the note type, has no subject and fits LinkedIn's limit; an email has a subject.
  check ((type = 'linkedin_note') = (channel = 'linkedin')),
  check ((channel = 'email') = (subject is not null)),
  check (channel <> 'linkedin' or char_length(body) <= 300),
  -- Review state is consistent, and only a passing draft can leave "draft".
  check ((status in ('approved', 'sent')) = (approved_at is not null)),
  check ((status = 'sent') = (sent_at is not null)),
  check (status = 'draft' or (verification ->> 'ok') = 'true')
);

create index outreach_drafts_user_idx on public.outreach_drafts (user_id, created_at desc);
create index outreach_drafts_job_idx on public.outreach_drafts (job_id);

create trigger outreach_drafts_set_updated_at
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();

create function public.guard_outreach_drafts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.outreach_drafts where user_id = new.user_id) >= 300 then
      raise exception 'outreach draft limit reached';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.status = 'sent' then
    raise exception 'sent drafts cannot change';
  end if;
  if old.status = 'approved' and (
       new.status not in ('approved', 'sent')
       or new.body is distinct from old.body
       or new.subject is distinct from old.subject
       or new.content is distinct from old.content
     ) then
    raise exception 'approved drafts cannot be edited';
  end if;
  return new;
end;
$$;

create trigger outreach_drafts_guard
  before insert or update on public.outreach_drafts
  for each row execute function public.guard_outreach_drafts();

alter table public.outreach_drafts enable row level security;

create policy outreach_drafts_select_own on public.outreach_drafts
  for select to authenticated using (user_id = (select auth.uid()));

-- A draft can only be written for a job the user can see.
create policy outreach_drafts_insert_own on public.outreach_drafts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.jobs j where j.id = job_id)
  );

create policy outreach_drafts_update_own on public.outreach_drafts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy outreach_drafts_delete_own on public.outreach_drafts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.outreach_drafts from anon, authenticated;
grant select, delete on public.outreach_drafts to authenticated;
grant insert (
  user_id, job_id, type, channel, recipient_name, recipient_title, shared_context, subject,
  body, content, verification, profile_hash, tailor_version
) on public.outreach_drafts to authenticated;
-- Who and what a draft is for never changes; only the words and the review state do.
grant update (subject, body, content, verification, profile_hash, status, approved_at, sent_at)
  on public.outreach_drafts to authenticated;
grant all on public.outreach_drafts to service_role;
