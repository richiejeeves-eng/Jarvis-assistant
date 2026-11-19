-- Jeeves Health Connect records
-- Applied to Supabase project aelsipdtezvhjkwsshqx.
create table if not exists public.health_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null,
  external_id text not null,
  start_time timestamptz,
  end_time timestamptz,
  value jsonb not null default '{}'::jsonb,
  source_app text,
  source_device text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, record_type, external_id)
);
alter table public.health_records enable row level security;
revoke all on public.health_records from anon;
grant select, insert, update, delete on public.health_records to authenticated;
drop policy if exists "Users manage own health records" on public.health_records;
create policy "Users manage own health records"
on public.health_records for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
