-- Remove unnecessary client-role privileges from device tokens and legacy tables.
-- Authenticated Android clients still retain their own-row RLS-scoped access.
revoke all on public.health_device_tokens from anon;
revoke all on public.activity_logs from anon, authenticated;
revoke all on public.test_jarvis from anon, authenticated;
