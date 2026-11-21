alter table public.memories
  add constraint memories_content_len
  check (char_length(content) between 1 and 2000) not valid;
alter table public.tasks
  add constraint tasks_title_len
  check (char_length(title) between 1 and 300) not valid;

alter table public.memories validate constraint memories_content_len;
alter table public.tasks validate constraint tasks_title_len;
