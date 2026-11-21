-- Remove empty development tables that have no foreign-key dependants.
DROP TABLE IF EXISTS public.test_jarvis;
DROP TABLE IF EXISTS public.activity_logs;

-- RLS policies already restrict these tables to the owning authenticated user.
-- Remove unnecessary anon table privileges as an additional defence-in-depth layer.
REVOKE ALL ON TABLE public.conversation_messages, public.memories, public.tasks FROM anon;
