create index if not exists knowledge_links_from_owner_idx
  on public.knowledge_links (from_item_id, user_id);
create index if not exists knowledge_links_to_owner_idx
  on public.knowledge_links (to_item_id, user_id);
