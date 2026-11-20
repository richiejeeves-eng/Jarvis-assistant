-- Keep Android device registration to the CRUD privileges the client requires.
revoke all on public.health_device_tokens from anon, authenticated;
grant select, insert, update, delete on public.health_device_tokens to authenticated;
