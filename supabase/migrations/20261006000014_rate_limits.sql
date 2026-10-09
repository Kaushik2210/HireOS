-- Shared rate limits.
--
-- Limits kept in each server's memory reset on every restart and are not shared between
-- instances. This table holds one counter per key so the whole deployment agrees. Keys are
-- hashed by the caller, so no email address or IP address is stored here.
--
-- Only the service role can call rate_limit_hit; no API role can read or write the table.

create table public.rate_limits (
  key text primary key check (char_length(key) between 1 and 200),
  hits integer not null check (hits >= 1),
  reset_at timestamptz not null
);

create index rate_limits_reset_at_idx on public.rate_limits (reset_at);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Counts one hit in a fixed window and says whether it is within the limit.
-- The count stops one past the limit, so a flood does not keep writing larger numbers.
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_ms integer)
returns table (ok boolean, retry_after_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := clock_timestamp();
  current_row public.rate_limits;
begin
  if p_limit < 1 or p_window_ms < 1 or p_window_ms > 86400000 then
    raise exception 'invalid rate limit settings';
  end if;

  insert into public.rate_limits as t (key, hits, reset_at)
  values (p_key, 1, now_ts + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set hits = case when t.reset_at <= now_ts then 1 else least(t.hits + 1, p_limit + 1) end,
        reset_at = case when t.reset_at <= now_ts then excluded.reset_at else t.reset_at end
  returning * into current_row;

  -- Housekeeping: now and then, drop windows that ended long ago.
  if random() < 0.02 then
    delete from public.rate_limits where reset_at < now_ts - interval '1 hour';
  end if;

  ok := current_row.hits <= p_limit;
  retry_after_ms := case
    when ok then 0
    else greatest(1, ceil(extract(epoch from (current_row.reset_at - now_ts)) * 1000)::integer)
  end;
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
