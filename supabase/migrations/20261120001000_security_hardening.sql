-- Harden per-user rate limits: callers can consume their own quota but cannot alter limits.
create or replace function private.consume_jeeves_ai_request()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / 60) * 60);
  insert into private.jeeves_ai_request_limits as current_limit(user_id, window_started_at, request_count)
  values (v_user_id, v_window, 1)
  on conflict (user_id) do update
    set window_started_at = excluded.window_started_at,
        request_count = case when current_limit.window_started_at = excluded.window_started_at
          then current_limit.request_count + 1 else 1 end
  returning request_count into v_count;
  return v_count <= 6;
end;
$$;

create or replace function private.consume_jeeves_voice_request()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / 60) * 60);
  insert into private.jeeves_voice_request_limits as current_limit(user_id, window_started_at, request_count)
  values (v_user_id, v_window, 1)
  on conflict (user_id) do update
    set window_started_at = excluded.window_started_at,
        request_count = case when current_limit.window_started_at = excluded.window_started_at
          then current_limit.request_count + 1 else 1 end
  returning request_count into v_count;
  return v_count <= 12;
end;
$$;

-- Remove the parameterised signatures entirely so PostgREST cannot select them.
drop function if exists public.consume_jeeves_ai_request(integer, integer);
drop function if exists private.consume_jeeves_ai_request(integer, integer);
drop function if exists public.consume_jeeves_voice_request(integer, integer);
drop function if exists private.consume_jeeves_voice_request(integer, integer);

create or replace function public.consume_jeeves_ai_request()
returns boolean language sql security invoker
set search_path = public, pg_temp
as $$ select private.consume_jeeves_ai_request(); $$;
create or replace function public.consume_jeeves_voice_request()
returns boolean language sql security invoker
set search_path = public, pg_temp
as $$ select private.consume_jeeves_voice_request(); $$;

revoke all on function private.consume_jeeves_ai_request() from public, anon;
revoke all on function private.consume_jeeves_voice_request() from public, anon;
grant execute on function private.consume_jeeves_ai_request() to authenticated;
grant execute on function private.consume_jeeves_voice_request() to authenticated;
revoke all on function public.consume_jeeves_ai_request() from public, anon;
revoke all on function public.consume_jeeves_voice_request() from public, anon;
grant execute on function public.consume_jeeves_ai_request() to authenticated;
grant execute on function public.consume_jeeves_voice_request() to authenticated;

-- A notification endpoint has its own fixed per-user budget.
create table if not exists private.jeeves_notification_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);
alter table private.jeeves_notification_request_limits enable row level security;
revoke all on private.jeeves_notification_request_limits from public, anon, authenticated;

create or replace function private.consume_jeeves_notification_request()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / 60) * 60);
  insert into private.jeeves_notification_request_limits as current_limit(user_id, window_started_at, request_count)
  values (v_user_id, v_window, 1)
  on conflict (user_id) do update
    set window_started_at = excluded.window_started_at,
        request_count = case when current_limit.window_started_at = excluded.window_started_at
          then current_limit.request_count + 1 else 1 end
  returning request_count into v_count;
  return v_count <= 4;
end;
$$;
revoke all on function private.consume_jeeves_notification_request() from public, anon;
grant execute on function private.consume_jeeves_notification_request() to authenticated;
create or replace function public.consume_jeeves_notification_request()
returns boolean language sql security invoker
set search_path = public, pg_temp
as $$ select private.consume_jeeves_notification_request(); $$;
revoke all on function public.consume_jeeves_notification_request() from public, anon;
grant execute on function public.consume_jeeves_notification_request() to authenticated;

-- The memory search RPC is only needed by signed-in users.
do $$
begin
  if to_regprocedure('public.search_memories(text,integer)') is not null then
    revoke all on function public.search_memories(text,integer) from public, anon;
    grant execute on function public.search_memories(text,integer) to authenticated;
  end if;
end $$;
