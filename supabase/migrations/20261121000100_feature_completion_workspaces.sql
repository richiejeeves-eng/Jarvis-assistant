-- Jeeves feature completion: durable, per-user workspaces.
-- Apply only after review; this file is not executed automatically.
create extension if not exists pgcrypto;

create table if not exists public.jeeves_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text not null default '',
  status text not null default 'active' check (status in ('active','on_hold','completed','archived')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists jeeves_projects_id_user_unique on public.jeeves_projects(id,user_id);
create table if not exists public.jeeves_project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  status text not null default 'pending' check (status in ('pending','completed')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  constraint jeeves_project_milestones_owner_fkey
    foreign key (project_id,user_id) references public.jeeves_projects(id,user_id) on delete cascade
);
create index if not exists jeeves_project_milestones_project_idx on public.jeeves_project_milestones(user_id,project_id,due_at);

create table if not exists public.jeeves_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  content text not null default '',
  status text not null default 'captured' check (status in ('captured','considering','approved','parked','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.jeeves_financial_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_type text not null check (entry_type in ('income','expense')),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'GBP',
  category text not null default 'General',
  description text not null default '',
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);
create table if not exists public.jeeves_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'GBP',
  period text not null default 'monthly' check (period in ('weekly','monthly','yearly')),
  category text not null default 'Overall',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.jeeves_fitness_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  log_type text not null check (log_type in ('meal','workout','measurement','habit')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  details text not null default '',
  quantity numeric(12,2),
  unit text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.jeeves_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  content text not null default '',
  document_type text not null default 'note',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['jeeves_projects','jeeves_project_milestones','jeeves_ideas','jeeves_financial_entries','jeeves_budgets','jeeves_fitness_logs','jeeves_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_owner_all', t);
  end loop;
end $$;

create index if not exists jeeves_projects_user_updated_idx on public.jeeves_projects(user_id, updated_at desc);
create index if not exists jeeves_ideas_user_updated_idx on public.jeeves_ideas(user_id, updated_at desc);
create index if not exists jeeves_finance_user_date_idx on public.jeeves_financial_entries(user_id, occurred_on desc);
create index if not exists jeeves_budgets_user_idx on public.jeeves_budgets(user_id);
create index if not exists jeeves_fitness_user_time_idx on public.jeeves_fitness_logs(user_id, logged_at desc);
create index if not exists jeeves_documents_user_updated_idx on public.jeeves_documents(user_id, updated_at desc);

-- Knowledge tables already exist in the connected database. Tighten ownership and add useful lookup indexes.
alter table public.knowledge_items enable row level security;
alter table public.knowledge_links enable row level security;
revoke all on public.knowledge_items, public.knowledge_links from anon;
grant select, insert, update, delete on public.knowledge_items, public.knowledge_links to authenticated;
drop policy if exists "Users can add their own knowledge" on public.knowledge_items;
drop policy if exists "Users can delete their own knowledge" on public.knowledge_items;
drop policy if exists "Users can read their own knowledge" on public.knowledge_items;
drop policy if exists "Users can update their own knowledge" on public.knowledge_items;
drop policy if exists knowledge_items_owner_all on public.knowledge_items;
create policy knowledge_items_owner_all on public.knowledge_items for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own knowledge links" on public.knowledge_links;
drop policy if exists "Users can delete their own knowledge links" on public.knowledge_links;
drop policy if exists "Users can read their own knowledge links" on public.knowledge_links;
drop policy if exists knowledge_links_owner_all on public.knowledge_links;
create policy knowledge_links_owner_all on public.knowledge_links for all to authenticated
using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.knowledge_items k where k.id = from_item_id and k.user_id = (select auth.uid()))
  and exists (select 1 from public.knowledge_items k where k.id = to_item_id and k.user_id = (select auth.uid()))
);
create index if not exists knowledge_links_from_fk_idx on public.knowledge_links(from_item_id);
create index if not exists knowledge_links_to_fk_idx on public.knowledge_links(to_item_id);

-- Maintain searchable text for knowledge records.
create or replace function public.jeeves_knowledge_search_vector() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.title,'') || ' ' || coalesce(new.content,'') || ' ' || coalesce(array_to_string(new.tags, ' '),''));
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists jeeves_knowledge_search_vector_trg on public.knowledge_items;
create trigger jeeves_knowledge_search_vector_trg before insert or update of title,content,tags on public.knowledge_items
for each row execute function public.jeeves_knowledge_search_vector();
update public.knowledge_items set search_vector = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || coalesce(array_to_string(tags, ' '),''))
where search_vector = ''::tsvector;
