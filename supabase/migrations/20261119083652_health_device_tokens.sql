-- Health Connect companion device registration.
create table if not exists public.health_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android' check (platform = 'android'),
  updated_at timestamptz not null default now()
);

create index if not exists health_device_tokens_user_idx
  on public.health_device_tokens (user_id);

alter table public.health_device_tokens enable row level security;
revoke all on public.health_device_tokens from anon;
grant select, insert, update, delete on public.health_device_tokens to authenticated;

drop policy if exists "Users manage their own health device tokens" on public.health_device_tokens;
create policy "Users manage their own health device tokens"
  on public.health_device_tokens for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
