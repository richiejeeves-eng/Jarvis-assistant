# Jeeves API v1

Jeeves API is the authenticated, path-versioned gateway for the Jeeves application. It is implemented as a Supabase Edge Function.

## Status

- Source only; not deployed.
- Existing browser and Android clients in this branch are wired to the gateway.
- Uses existing Supabase Auth sessions and Row Level Security.
- No database migration or new paid service is required.
- Voice generation through paid external APIs is disabled in source; the app uses device/browser speech. The already-deployed legacy voice endpoint remains unchanged until an approved deployment.
- Do not enable billing, merge or deploy without the owner's explicit approval.

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/jeeves-api
```

Every request requires both headers:

```
Authorization: Bearer <signed-in-user-access-token>
apikey: <Supabase publishable key>
```

Keep platform JWT verification enabled (`verify_jwt = true`, the Supabase default). The function also validates the user session itself.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1` | Authenticated API catalogue and version |
| POST | `/v1/brain` | Forward chat request to `jeeves-brain` |
| POST | `/v1/google` | Forward an existing Google integration action to `google-calendar` |
| POST | `/v1/health/sync` | Validate and store Health Connect records through `health-sync` |
| POST | `/v1/health/notify` | Trigger an authorised Health Connect sync notification |
| GET | `/v1/data/{table}` | Read caller-owned rows from an approved data table |
| POST | `/v1/data/{table}` | Insert rows into an approved data table |
| PATCH | `/v1/data/{table}?id=eq.{uuid}` | Update one caller-owned row; exactly one UUID selector required |
| DELETE | `/v1/data/{table}?id=eq.{uuid}` | Delete one caller-owned row; exactly one UUID selector required |
| POST | `/v1/voice` | Returns `501 FEATURE_DISABLED`; use device speech |

Approved data tables: `tasks`, `memories`, `conversations`, `conversation_messages`, `health_records`.

Health records are read-only through the generic data route. Use the validated health sync route to insert/update them. Google OAuth redirects continue to use the registered `google-calendar` callback URL; normal integration actions go through Jeeves API.

## Examples

Get the API catalogue:

```http
GET /functions/v1/jeeves-api/v1
Authorization: Bearer <access-token>
apikey: <publishable-key>
```

Send a chat request:

```http
POST /functions/v1/jeeves-api/v1/brain
Content-Type: application/json

{
  "message": "Help me plan my week.",
  "active_advisers": ["mind", "body", "soul"],
  "mode": 3
}
```

Call Google Calendar:

```http
POST /functions/v1/jeeves-api/v1/google
Content-Type: application/json

{
  "action": "status"
}
```

List tasks:

```http
GET /functions/v1/jeeves-api/v1/data/tasks?select=id,title,due_at,status&order=due_at.asc
```

Create a task only after the user explicitly confirms:

```http
POST /functions/v1/jeeves-api/v1/data/tasks
Content-Type: application/json
Prefer: return=representation

{
  "title": "Book dentist",
  "due_at": "2026-12-01T09:00:00Z",
  "confirmed": true
}
```

Save a memory only after explicit confirmation:

```http
POST /functions/v1/jeeves-api/v1/data/memories
Content-Type: application/json
Prefer: return=representation

{
  "content": "Prefers concise weekly planning.",
  "category": "preferences",
  "confirmed": true
}
```

Sync health records:

```http
POST /functions/v1/jeeves-api/v1/health/sync
Content-Type: application/json

{
  "records": []
}
```

## Security and privacy

- Every route requires a valid signed-in Supabase user.
- Data requests use the caller's JWT and Supabase RLS; no service-role key is used by the gateway.
- The generic data route allowlists table names and strips client-supplied `user_id`. RLS determines row ownership.
- `tasks` and `memories` inserts require `confirmed: true`; memory content is limited to 2,000 characters and task titles to 180 characters.
- `health_records` is read-only through the generic data route.
- Health records are not automatically attached to brain requests or forwarded to AI providers.
- Request bodies and query strings have size limits. Data reads are capped at 100 rows per request. API responses include request IDs.
- Browser CORS is restricted to the production GitHub Pages origin and local development origins. Native clients without an Origin header can use their authenticated session.
- Brain and notification endpoints retain their existing per-user controls. Health sync has no separate per-user throttle yet; requests are limited to 100 records and 512 KB.
- Server-side paid voice generation is disabled; browser/device speech has no per-call API charge.

## Deployment sequence (not performed)

1. Review and merge PR #4 only with explicit approval.
2. Verify the selected AI model exists and provider terms permit intended UK use; keep billing disabled.
3. Deploy `jeeves-brain`, `health-sync`, `health-sync-notify`, `google-calendar` and the disabled `jeeves-voice` source as required.
4. Deploy `jeeves-api` with JWT verification enabled.
5. Run authenticated smoke tests for every route.
6. Publish the updated browser/Android clients only after the gateway is live and verified.

No gateway deployment, secret changes, database migrations or billing changes are part of this work.
