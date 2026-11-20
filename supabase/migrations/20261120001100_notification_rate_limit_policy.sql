drop policy if exists "Deny direct client access to notification rate limit counters" on private.jeeves_notification_request_limits;
create policy "Deny direct client access to notification rate limit counters"
  on private.jeeves_notification_request_limits for all to authenticated
  using (false) with check (false);
