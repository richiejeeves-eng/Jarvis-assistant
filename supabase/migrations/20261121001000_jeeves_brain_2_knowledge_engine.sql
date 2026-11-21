-- Jeeves Brain 2: private, consent-gated long-term knowledge engine.
-- Keyword/full-text retrieval keeps the core engine free of paid embedding APIs.

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  content text not null check (char_length(content) between 1 and 12000),
  category text not null default 'general' check (char_length(category) between 1 and 60),
  tags text[] not null default '{}'::text[],
  source text not null default 'user' check (source in ('user', 'conversation', 'project', 'document', 'assistant')),
  consent_status text not null default 'pending' check (consent_status in ('pending', 'approved', 'revoked')),
  confidence numeric(3,2) not null default 1.00 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  archived_at timestamptz,
  search_vector tsvector not null default ''::tsvector,
  constraint knowledge_items_id_user_unique unique (id, user_id)
);

create or replace function public.knowledge_items_refresh_search_vector()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.search_vector :=
    pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(new.title, '')), 'A') ||
    pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(new.content, '')), 'B') ||
    pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(array_to_string(new.tags, ' '), '')), 'C');
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.knowledge_items_refresh_search_vector() from public, anon, authenticated;
create trigger knowledge_items_refresh_search_vector
  before insert or update of title, content, tags on public.knowledge_items
  for each row execute function public.knowledge_items_refresh_search_vector();

create index knowledge_items_search_idx on public.knowledge_items using gin (search_vector);
create index knowledge_items_user_created_idx on public.knowledge_items (user_id, created_at desc);
create index knowledge_items_user_category_idx on public.knowledge_items (user_id, category);

alter table public.knowledge_items enable row level security;
revoke all on public.knowledge_items from public, anon;
grant select, insert, update, delete on public.knowledge_items to authenticated;
create policy "Users can read their own knowledge" on public.knowledge_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their own knowledge" on public.knowledge_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own knowledge" on public.knowledge_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own knowledge" on public.knowledge_items for delete to authenticated using ((select auth.uid()) = user_id);

create table public.knowledge_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_item_id uuid not null,
  to_item_id uuid not null,
  relation text not null check (char_length(relation) between 1 and 80),
  created_at timestamptz not null default now(),
  constraint knowledge_links_not_self check (from_item_id <> to_item_id),
  constraint knowledge_links_from_owner_fk foreign key (from_item_id, user_id) references public.knowledge_items(id, user_id) on delete cascade,
  constraint knowledge_links_to_owner_fk foreign key (to_item_id, user_id) references public.knowledge_items(id, user_id) on delete cascade,
  constraint knowledge_links_unique unique (user_id, from_item_id, to_item_id, relation)
);
create index knowledge_links_user_from_idx on public.knowledge_links (user_id, from_item_id);
create index knowledge_links_user_to_idx on public.knowledge_links (user_id, to_item_id);
alter table public.knowledge_links enable row level security;
revoke all on public.knowledge_links from public, anon;
grant select, insert, delete on public.knowledge_links to authenticated;
create policy "Users can read their own knowledge links" on public.knowledge_links for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own knowledge links" on public.knowledge_links for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can delete their own knowledge links" on public.knowledge_links for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.search_knowledge(search_text text, max_results integer default 8)
returns table (id uuid, title text, content text, category text, tags text[], source text, confidence numeric, created_at timestamptz, relevance real)
language sql stable security invoker set search_path = ''
as $$
  select k.id, k.title, k.content, k.category, k.tags, k.source, k.confidence, k.created_at,
    pg_catalog.ts_rank_cd(k.search_vector, pg_catalog.websearch_to_tsquery('english'::pg_catalog.regconfig, coalesce(search_text, ''))) as relevance
  from public.knowledge_items as k
  where k.user_id = (select auth.uid())
    and k.consent_status = 'approved'
    and k.archived_at is null
    and pg_catalog.websearch_to_tsquery('english'::pg_catalog.regconfig, coalesce(search_text, '')) @@ k.search_vector
  order by relevance desc, k.updated_at desc
  limit greatest(1, least(coalesce(max_results, 8), 20));
$$;
revoke all on function public.search_knowledge(text, integer) from public, anon;
grant execute on function public.search_knowledge(text, integer) to authenticated;
