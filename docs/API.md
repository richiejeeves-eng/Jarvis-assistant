# Jeeves API v1

Jeeves API is a versioned, authenticated facade over the existing Supabase Edge Functions and user-scoped data tables.

## Status

- Source only: this API has **not** been deployed.
- No Supabase database changes are required for the gateway.
- No billing is enabled and no paid fallback is configured.
- The API requires a signed-in Jeeves user. It is not an anonymous public API.

## Base URL

`https://aelsipdtezvhjkwsshqx.supabase.co/functions/v1/jeeves-api`

All routes below are relative to this base URL.

## Authentication

Send both headers:

```http
Authorization: Bearer <Supabase user access token>
apikey: <Supabase publishable key>
Content-Type: application/json
```

Never send a service-role key from a browser, mobile app, or third-party client. The gateway validates the user JWT and forwards that same user identity. Data routes use the user's JWT so existing Postgres grants and Row Level Security policies remain in force.

## Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1` | Authenticated API catalogue |
| POST | `/v1/brain` | Jeeves AI conversation |
| POST | `/v1/google` | Google Calendar, Tasks, Gmail and Drive actions |
| POST | `/v1/health/sync` | Store Health Connect records |
| POST | `/v1/health/notify` | Trigger an authorised device sync notification |
| GET, POST, PATCH, DELETE | `/v1/data/tasks` | User's tasks |
| GET, POST, PATCH, DELETE | `/v1/data/memories` | User's saved memories |
| GET, POST, PATCH, DELETE | `/v1/data/conversations` | User's conversations |
| GET, POST, PATCH, DELETE | `/v1/data/conversation_messages` | Messages in user's conversations |
| GET, POST, PATCH, DELETE | `/v1/data/health_records` | User's health records |

Only the five named data resources are proxied. The gateway does not accept arbitrary table names, schemas, URLs, or function names.

### Voice

`POST /v1/voice` intentionally returns `501 FEATURE_DISABLED`. The current standalone voice function uses ElevenLabs and may consume account credits. It will not be exposed through the unified API until a verified no-cost voice provider is selected. The existing standalone function is not changed by this source-only work.

## Examples

### Ask Jeeves

```http
POST /v1/brain
Authorization: Bearer <access-token>
apikey: <publishable-key>
Content-Type: application/json

{
  "message": "Help me plan my week",
  "mode": 3,
  "timezone": "Europe/London"
}
```

### Read tasks

```http
GET /v1/data/tasks?select=id,title,due_at,status&status=eq.pending&order=due_at.asc
Authorization: Bearer <access-token>
apikey: <publishable-key>
```

### Use Google integrations

```http
POST /v1/google
Authorization: Bearer <access-token>
apikey: <publishable-key>
Content-Type: application/json

{
  "action": "events",
  "timeMin": "2026-11-21T00:00:00Z",
  "timeMax": "2026-11-28T00:00:00Z"
}
```

### Sync health records

```http
POST /v1/health/sync
Authorization: Bearer <access-token>
apikey: <publishable-key>
Content-Type: application/json

{
  "records": []
}
```

## Limits and safety

- User JWT required on every non-preflight route.
- Data writes are JSON only and limited to 1 MB per request.
- Function proxy requests are limited to 4.5 MB.
- Data access is constrained to an explicit table allowlist and existing RLS policies.
- AI rate limiting remains in the Jeeves Brain function. Health notification rate limiting remains in its function.
- Health records are never automatically forwarded to the AI Brain.
- The gateway does not create tasks or memories by itself; the existing Brain intent checks and database policies remain authoritative.
- Unknown routes and methods are rejected.
- Responses are marked `Cache-Control: no-store`.

## Free-service policy

The gateway itself introduces no paid service. Supabase's free-plan quotas still apply. The AI provider and external Google/Firebase integrations have their own free-tier terms and quotas; exceeding a free quota may stop requests. Do not enable billing or paid fallback providers without explicit approval.

## Deployment checklist (not performed)

1. Review this source and the API contract.
2. Verify the AI provider/model is valid and permitted for UK usage.
3. Verify Supabase free-plan capacity and provider quotas.
4. Run CI and security review.
5. Obtain explicit approval before merging or deploying.
