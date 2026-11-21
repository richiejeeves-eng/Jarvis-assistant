import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigins = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://richiejeeves-eng.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedSources = new Set(["user", "conversation", "project", "document", "assistant"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405, origin);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Sign in required" }, 401, origin);

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 64_000) {
      return json({ error: "Request body too large" }, 413, origin);
    }
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("Invalid body");
      body = parsed;
    } catch {
      return json({ error: "Valid JSON object required" }, 400, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session" }, 401, origin);

    const { data: allowed, error: limitError } = await supabase.rpc("consume_jeeves_ai_request");
    if (limitError) return json({ error: "Knowledge service temporarily unavailable" }, 503, origin);
    if (allowed !== true) return json({ error: "Request limit reached; try again shortly" }, 429, origin);

    const action = body.action;
    if (action === "search") {
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 500) : "";
      if (query.length < 2) return json({ error: "Search query must be at least 2 characters" }, 400, origin);
      const { data, error } = await supabase.rpc("search_knowledge", {
        search_text: query,
        max_results: typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.max(1, Math.min(body.limit, 20)) : 8,
      });
      if (error) throw error;
      return json({ results: data ?? [] }, 200, origin);
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("knowledge_items")
        .select("id,title,category,tags,source,consent_status,confidence,created_at,updated_at,archived_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({ items: data ?? [] }, 200, origin);
    }

    if (action === "remember") {
      if (body.confirm_remember !== true) {
        return json({ error: "Explicit confirm_remember: true is required before saving" }, 403, origin);
      }
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!title || title.length > 240 || !content || content.length > 12_000) {
        return json({ error: "Title (1–240) and content (1–12000 characters) are required" }, 400, origin);
      }
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 60)).filter(Boolean).slice(0, 12)
        : [];
      const source = typeof body.source === "string" && allowedSources.has(body.source) ? body.source : "user";
      const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence)
        ? Math.max(0, Math.min(1, body.confidence))
        : 1;
      const category = typeof body.category === "string" ? body.category.trim().slice(0, 60) || "general" : "general";
      const metadata = isRecord(body.metadata) ? body.metadata : {};
      const { data, error } = await supabase
        .from("knowledge_items")
        .insert({ title, content, category, tags, source, confidence, metadata, consent_status: "approved" })
        .select("id,title,category,tags,consent_status,created_at")
        .single();
      if (error) throw error;
      return json({ saved: true, item: data }, 201, origin);
    }

    if (action === "approve" || action === "revoke" || action === "archive") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!uuidPattern.test(id)) return json({ error: "Valid item id required" }, 400, origin);
      const patch = action === "approve"
        ? { consent_status: "approved" }
        : action === "revoke"
        ? { consent_status: "revoked" }
        : { archived_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from("knowledge_items")
        .update(patch)
        .eq("id", id)
        .select("id,title,consent_status,archived_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Knowledge item not found" }, 404, origin);
      return json({ updated: true, item: data }, 200, origin);
    }

    if (action === "link") {
      const from = typeof body.from_item_id === "string" ? body.from_item_id : "";
      const to = typeof body.to_item_id === "string" ? body.to_item_id : "";
      const relation = typeof body.relation === "string" ? body.relation.trim().slice(0, 80) : "";
      if (!uuidPattern.test(from) || !uuidPattern.test(to) || !relation || from === to) {
        return json({ error: "Two different valid item IDs and a relation are required" }, 400, origin);
      }
      const { data, error } = await supabase
        .from("knowledge_links")
        .insert({ from_item_id: from, to_item_id: to, relation })
        .select("id,from_item_id,to_item_id,relation,created_at")
        .single();
      if (error) throw error;
      return json({ linked: true, link: data }, 201, origin);
    }

    if (action === "unlink") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!uuidPattern.test(id)) return json({ error: "Valid link id required" }, 400, origin);
      const { error } = await supabase.from("knowledge_links").delete().eq("id", id);
      if (error) throw error;
      return json({ unlinked: true }, 200, origin);
    }

    if (action === "delete") {
      if (body.confirm_delete !== true) return json({ error: "Explicit confirm_delete: true is required" }, 403, origin);
      const id = typeof body.id === "string" ? body.id : "";
      if (!uuidPattern.test(id)) return json({ error: "Valid item id required" }, 400, origin);
      const { error } = await supabase.from("knowledge_items").delete().eq("id", id);
      if (error) throw error;
      return json({ deleted: true }, 200, origin);
    }

    return json({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    console.error("Jeeves knowledge engine error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Knowledge request failed" }, 500, origin);
  }
});
