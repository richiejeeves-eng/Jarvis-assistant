-- The private SECURITY DEFINER implementation is the only intended reader/writer.
create policy "Deny direct client access to AI rate limit counters"
  on private.jeeves_ai_request_limits
  for all
  to authenticated
  using (false)
  with check (false);
