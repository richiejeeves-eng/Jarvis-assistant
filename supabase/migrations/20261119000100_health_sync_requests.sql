-- Queue authenticated Jeeves Fitness requests for the Android Jeeves Health companion.
create table public.health_sync_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text
);

create index health_sync_requests_user_status_idx
  on public.health_sync_requests (user_id, status, requested_at desc);

alter table public.health_sync_requests enable row level security;
grant select, insert, update on public.health_sync_requests to authenticated;

create policy "Users can view their own health sync requests"
  on public.health_sync_requests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own health sync requests"
  on public.health_sync_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own health sync requests"
  on public.health_sync_requests for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
