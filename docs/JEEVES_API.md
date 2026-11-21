# Jeeves API v1

Jeeves API is the authenticated application gateway for Jeeves services. It is implemented as a Supabase Edge Function and is designed to keep service credentials on the server.

## Status

- Source only; not deployed.
- Requires the existing `jeeves-brain`, `health-sync`, `google-calendar` and `jeeves-voice` Edge Functions.
- Uses the existing Supabase Auth session and Row Level Security policies.
- No database migration or new paid service is required.
- Do not enable billing or deploy without the owner's explicit approval.

## Endpoint

After deployment:

```
POST https://<project-ref>.supabase.co/functions/v1/jeeves-api
Authorization: Bearer <signed-in-user-access-token>
apikey: <Supabase publishable/anon key>
Content-Type: application/json
```

All requests use this envelope:

```json
{
  "action": "tasks.list",
  "payload": {
    "limit": 25
  }
}
```

The function requires a valid signed-in Supabase user. It also validates the session inside the handler. Keep platform JWT verification enabled (`verify_jwt = true`, the default).

## Actions

| Action | Purpose |
|---|---|
| `system.status` | Returns API version and registered service names; not a live dependency health check |
| `ai.chat` | Forwards request payload to `jeeves-brain` |
| `health.sync` | Forwards health sync payload to `health-sync` |
| `health.records.list` | Returns caller-owned health records, maximum 100 |
| `tasks.list` | Lists caller-owned tasks, maximum 100 |
| `tasks.create` | Creates a local Jeeves task; requires `confirmed: true` |
| `tasks.update` | Updates caller-owned task title, description, status or due date |
| `tasks.delete` | Deletes caller-owned task |
| `memories.list` | Lists caller-owned memories, maximum 100 |
| `memories.create` | Saves a memory; requires `confirmed: true` |
| `memories.delete` | Deletes caller-owned memory |
| `conversations.list` | Lists caller-owned conversations, maximum 50 |
| `conversations.create` | Creates a conversation |
| `conversations.messages.list` | Lists messages for a caller-owned conversation |
| `conversations.messages.create` | Saves a message in a caller-owned conversation |
| `google.action` | Forwards payload to `google-calendar`; payload must include its existing `action` field |
| `voice.generate` | Forwards text/voice payload to `jeeves-voice`; returns audio |

## Examples

List tasks:

```json
{
  "action": "tasks.list",
  "payload": { "limit": 25 }
}
```

Create a task only after the user has explicitly confirmed:

```json
{
  "action": "tasks.create",
  "payload": {
    "title": "Book dentist",
    "due_at": "2026-12-01T09:00:00Z",
    "confirmed": true
  }
}
```

Save a memory only after explicit confirmation:

```json
{
  "action": "memories.create",
  "payload": {
    "content": "Prefers concise weekly planning.",
    "category": "preferences",
    "confirmed": true
  }
}
```

Send a chat request:

```json
{
  "action": "ai.chat",
  "payload": {
    "message": "Help me plan my week.",
    "active_advisers": ["mind", "body", "soul"],
    "mode": 3
  }
}
```

## Security and privacy

- Every action requires a valid signed-in Supabase user.
- Direct database actions use the user's JWT-scoped Supabase client; RLS remains in force. The gateway also filters rows by the authenticated user's ID.
- No service-role key or AI provider key is sent to the browser.
- Health records can be retrieved only by their owner. They are not automatically attached to `ai.chat` payloads and are not forwarded by the gateway to an AI provider.
- Task and memory creation require an explicit `confirmed: true` flag.
- Request bodies are limited to 4.5 MB; list responses are bounded.
- Browser CORS is restricted to the production GitHub Pages origin and local development origins. Native clients without an Origin header can use their authenticated session.
- AI and voice calls retain their existing per-user rate limits in their downstream functions.

## Deployment order (not performed)

1. Review and merge the prerequisite source changes in PR #4.
2. Verify the chosen AI model and provider terms for UK use and the free-tier privacy trade-off.
3. Deploy `jeeves-brain` and confirm its secrets/configuration are correct.
4. Deploy `jeeves-api` with JWT verification enabled.
5. Run authenticated smoke tests for each action.
6. Only then switch app clients to the gateway.

No deployment, secret changes, database migrations or billing changes are part of this branch.
