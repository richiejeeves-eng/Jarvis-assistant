-- JEEVES assistant feedback schema
-- This schema has already been applied to the connected Supabase project.

create unique index if not exists conversation_messages_id_conversation_user_uidx
  on public.conversation_messages (id, conversation_id, user_id);

create table if not exists public.assistant_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  assistant_message_id uuid not null,
  feedback_type text not null check (feedback_type in ('helpful','unhelpful','correction')),
  rating smallint,
  correction text,
  created_at timestamptz not null default now(),
  constraint assistant_feedback_rating_check check (rating is null or rating in (-1, 1)),
  constraint assistant_feedback_correction_check check (correction is null or char_length(correction) <= 4000),
  constraint assistant_feedback_message_owner_fkey
    foreign key (assistant_message_id, conversation_id, user_id)
    references public.conversation_messages (id, conversation_id, user_id)
    on delete cascade,
  constraint assistant_feedback_type_rating_check check (
    (feedback_type = 'helpful' and rating = 1 and correction is null) or
    (feedback_type = 'unhelpful' and rating = -1 and correction is null) or
    (feedback_type = 'correction' and rating is null and correction is not null and char_length(trim(correction)) > 0)
  )
);

create index if not exists assistant_feedback_user_created_idx
  on public.assistant_feedback (user_id, created_at desc);
create index if not exists assistant_feedback_message_idx
  on public.assistant_feedback (assistant_message_id);
create index if not exists assistant_feedback_message_owner_idx
  on public.assistant_feedback (assistant_message_id, conversation_id, user_id);

alter table public.assistant_feedback enable row level security;
grant select, insert on public.assistant_feedback to authenticated;

drop policy if exists "Users can view their own assistant feedback" on public.assistant_feedback;
create policy "Users can view their own assistant feedback"
  on public.assistant_feedback for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can submit their own assistant feedback" on public.assistant_feedback;
create policy "Users can submit their own assistant feedback"
  on public.assistant_feedback for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.conversation_messages m
      where m.id = assistant_message_id
        and m.conversation_id = assistant_feedback.conversation_id
        and m.user_id = assistant_feedback.user_id
        and m.role = 'assistant'
    )
  );
