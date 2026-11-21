# Jeeves Brain 2 — Knowledge Engine

Brain 2 is the long-term knowledge store and retrieval layer. Brain 1 remains the reasoning/adviser engine.

## Design
- Existing Supabase Postgres project; no additional service or paid embedding API.
- Native Postgres full-text search (GIN index) for keyword and phrase retrieval.
- Per-user Row Level Security on knowledge and relationship tables.
- Cross-user links are prevented by composite foreign keys containing `user_id`.
- Explicit consent is required to save through the Edge Function (`confirm_remember: true`).
- Search returns only approved, non-archived items.
- Pending and revoked items are not supplied to Brain 1 by search.
- User can approve, revoke, archive, unlink, or permanently delete knowledge.
- No automatic ingestion of conversations, files, health data, or personal details.

## Database
Migration: `supabase/migrations/20261121001000_jeeves_brain_2_knowledge_engine.sql`

Tables:
- `public.knowledge_items`: title, content, category, tags, source, consent status, confidence, metadata, timestamps.
- `public.knowledge_links`: typed relationships between two items owned by the same user.

RPC:
- `search_knowledge(search_text, max_results)`: RLS-scoped full-text retrieval. Result limit is capped at 20.

## Edge Function
Source: `supabase/functions/jeeves-memory/index.ts`

Endpoint after deployment:
`POST /functions/v1/jeeves-memory`

Through the authenticated Jeeves API gateway:
`POST /functions/v1/jeeves-api/v1/memory`

The gateway source is tracked at `supabase/functions/jeeves-api/index.ts`; it forwards the caller JWT to `jeeves-memory`.

Actions: `search`, `list`, `remember`, `approve`, `revoke`, `archive`, `list_links`, `link`, `unlink`, `delete`.

All calls require a valid signed-in user's JWT. The function uses the caller's Supabase session and does not use the service-role key.

## Important deployment boundary
The database schema and timestamp-trigger correction have been applied to the existing project. `jeeves-memory`, the updated `jarvis-brain`, and the gateway memory route are source-controlled but not deployed. No authenticated end-to-end test has been run. Deployment, merge, and client publication remain separate approval gates.
