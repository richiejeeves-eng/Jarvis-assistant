-- Per-user fixed-window rate limiting for Gemini-backed Jeeves requests.
-- The table is intentionally inaccessible to clients; only the SECURITY DEFINER
-- function below can read or update counters.
create table if not exists public.jeeves_ai_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.jeeves_ai_request_limits enable row level security;
revoke all on public.jeeves_ai_request_limits from anon, authenticated;

create or replace function public.consume_jeeves_ai_request(
  p_window_seconds integer default 60,
  p_max_requests integer default 6
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 3600
     or p_max_requests < 1 or p_max_requests > 100 then
    raise exception 'Invalid rate limit configuration';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.jeeves_ai_request_limits as current_limit(user_id, window_started_at, request_count)
  values (v_user_id, v_window, 1)
  on conflict (user_id) do update
    set window_started_at = excluded.window_started_at,
        request_count = case
          when current_limit.window_started_at = excluded.window_started_at
            then current_limit.request_count + 1
          else 1
        end
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_jeeves_ai_request(integer, integer) from public, anon;
grant execute on function public.consume_jeeves_ai_request(integer, integer) to authenticated;
