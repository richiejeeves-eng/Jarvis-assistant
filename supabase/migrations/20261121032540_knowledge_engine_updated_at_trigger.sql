-- Keep updated_at meaningful for consent, archive and metadata changes too.
create or replace function public.knowledge_items_refresh_search_vector()
returns trigger
language plpgsql
set search_path = ''
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

drop trigger if exists knowledge_items_refresh_search_vector on public.knowledge_items;
create trigger knowledge_items_refresh_search_vector
  before insert or update on public.knowledge_items
  for each row execute function public.knowledge_items_refresh_search_vector();
