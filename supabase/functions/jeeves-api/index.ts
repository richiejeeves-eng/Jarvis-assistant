import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const API_VERSION = "v1";
const MAX_BODY_BYTES = 4_500_000;
const ALLOWED_ORIGINS = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

type JsonObject = Record<string, unknown>;

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseDate(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 50) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Server configuration is incomplete.");
  return value;
}

function userClient(authorization: string) {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function proxyFunction(
  functionName: string,
  payload: JsonObject,
  authorization: string,
): Promise<Response> {
  const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(baseUrl + "/functions/v1/" + functionName, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "apikey": requiredEnv("SUPABASE_ANON_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(functionName === "jeeves-brain" ? 50_000 : 30_000),
  });
  const contentType = response.headers.get("Content-Type") || "application/json";
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

async function dispatch(
  action: string,
  payload: JsonObject,
  client: ReturnType<typeof userClient>,
  userId: string,
  authorization: string,
): Promise<Response> {
  switch (action) {
    case "system.status":
      return json({
        ok: true,
        api: API_VERSION,
        services: {
          ai: "jeeves-brain",
          healthSync: "health-sync",
          healthRecords: "managed-by-user-session",
          tasks: "managed-by-user-session",
          memories: "managed-by-user-session",
          conversations: "managed-by-user-session",
          google: "google-calendar",
          voice: "browser-native speech; API generation disabled",
        },
      });

    case "ai.chat":
      return await proxyFunction("jeeves-brain", payload, authorization);

    case "health.sync":
      return await proxyFunction("health-sync", payload, authorization);

    case "health.notify":
      return await proxyFunction("health-sync-notify", payload, authorization);

    case "health.records.list": {
      const limit = boundedInt(payload.limit, 50, 1, 100);
      let query = client.from("health_records")
        .select("id,record_type,external_id,start_time,end_time,value,source_app,source_device,recorded_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(limit);
      if (typeof payload.record_type === "string" && payload.record_type.length <= 40) {
        query = query.eq("record_type", payload.record_type);
      }
      const { data, error } = await query;
      if (error) return json({ error: "Could not retrieve health records." }, 500);
      return json({ data: data ?? [] });
    }

    case "tasks.list": {
      const limit = boundedInt(payload.limit, 50, 1, 100);
      const { data, error } = await client.from("tasks")
        .select("id,title,description,status,due_at,created_at,source,group_name,google_task_id,google_tasklist_id")
        .eq("user_id", userId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (error) return json({ error: "Could not retrieve tasks." }, 500);
      return json({ data: data ?? [] });
    }

    case "tasks.create": {
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      if (payload.confirmed !== true) return json({ error: "Explicit user confirmation is required to create a task." }, 400);
      if (!title || title.length > 200) return json({ error: "Task title must be 1 to 200 characters." }, 400);
      const dueAt = parseDate(payload.due_at);
      if (dueAt === undefined) return json({ error: "Invalid due_at date." }, 400);
      const description = typeof payload.description === "string" ? payload.description.trim().slice(0, 2000) : null;
      const { data, error } = await client.from("tasks").insert({
        user_id: userId,
        title,
        description,
        due_at: dueAt,
        status: "pending",
        source: "jeeves",
      }).select("id,title,description,status,due_at,created_at").single();
      if (error) return json({ error: "Could not create task." }, 500);
      return json({ data }, 201);
    }

    case "tasks.update": {
      if (!validUuid(payload.id)) return json({ error: "A valid task id is required." }, 400);
      const update: JsonObject = {};
      if (typeof payload.title === "string") {
        const title = payload.title.trim();
        if (!title || title.length > 200) return json({ error: "Task title must be 1 to 200 characters." }, 400);
        update.title = title;
      }
      if (typeof payload.description === "string") update.description = payload.description.trim().slice(0, 2000);
      if (payload.status === "pending" || payload.status === "done") update.status = payload.status;
      if ("due_at" in payload) {
        const dueAt = parseDate(payload.due_at);
        if (dueAt === undefined) return json({ error: "Invalid due_at date." }, 400);
        update.due_at = dueAt;
      }
      if (!Object.keys(update).length) return json({ error: "No supported task changes supplied." }, 400);
      const { data, error } = await client.from("tasks").update(update)
        .eq("id", payload.id).eq("user_id", userId)
        .select("id,title,description,status,due_at,created_at").maybeSingle();
      if (error) return json({ error: "Could not update task." }, 500);
      if (!data) return json({ error: "Task not found." }, 404);
      return json({ data });
    }

    case "tasks.delete": {
      if (!validUuid(payload.id)) return json({ error: "A valid task id is required." }, 400);
      const { data, error } = await client.from("tasks").delete()
        .eq("id", payload.id).eq("user_id", userId)
        .select("id").maybeSingle();
      if (error) return json({ error: "Could not delete task." }, 500);
      if (!data) return json({ error: "Task not found." }, 404);
      return json({ deleted: true, id: data.id });
    }

    case "memories.list": {
      const limit = boundedInt(payload.limit, 50, 1, 100);
      const { data, error } = await client.from("memories")
        .select("id,content,category,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: "Could not retrieve memories." }, 500);
      return json({ data: data ?? [] });
    }

    case "memories.create": {
      const content = typeof payload.content === "string" ? payload.content.trim() : "";
      if (payload.confirmed !== true) return json({ error: "Explicit user confirmation is required to save a memory." }, 400);
      if (!content || content.length > 2000) return json({ error: "Memory content must be 1 to 2000 characters." }, 400);
      const category = typeof payload.category === "string" ? payload.category.trim().slice(0, 60) : "general";
      const { data, error } = await client.from("memories").insert({
        user_id: userId,
        content,
        category: category || "general",
      }).select("id,content,category,created_at").single();
      if (error) return json({ error: "Could not save memory." }, 500);
      return json({ data }, 201);
    }

    case "memories.delete": {
      if (!validUuid(payload.id)) return json({ error: "A valid memory id is required." }, 400);
      const { data, error } = await client.from("memories").delete()
        .eq("id", payload.id).eq("user_id", userId)
        .select("id").maybeSingle();
      if (error) return json({ error: "Could not delete memory." }, 500);
      if (!data) return json({ error: "Memory not found." }, 404);
      return json({ deleted: true, id: data.id });
    }

    case "conversations.list": {
      const { data, error } = await client.from("conversations")
        .select("id,title,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(boundedInt(payload.limit, 30, 1, 50));
      if (error) return json({ error: "Could not retrieve conversations." }, 500);
      return json({ data: data ?? [] });
    }

    case "conversations.create": {
      const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 120) : "New conversation";
      const { data, error } = await client.from("conversations").insert({
        user_id: userId,
        title: title || "New conversation",
      }).select("id,title,created_at,updated_at").single();
      if (error) return json({ error: "Could not create conversation." }, 500);
      return json({ data }, 201);
    }

    case "conversations.messages.list": {
      if (!validUuid(payload.conversation_id)) return json({ error: "A valid conversation_id is required." }, 400);
      const { data, error } = await client.from("conversation_messages")
        .select("id,conversation_id,role,content,created_at")
        .eq("conversation_id", payload.conversation_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(boundedInt(payload.limit, 200, 1, 250));
      if (error) return json({ error: "Could not retrieve conversation messages." }, 500);
      return json({ data: data ?? [] });
    }

    case "conversations.messages.create": {
      if (!validUuid(payload.conversation_id)) return json({ error: "A valid conversation_id is required." }, 400);
      const role = payload.role;
      const content = typeof payload.content === "string" ? payload.content.trim() : "";
      if (role !== "user" && role !== "assistant" && role !== "model") {
        return json({ error: "role must be user, assistant or model." }, 400);
      }
      if (!content || content.length > 20_000) return json({ error: "Message content must be 1 to 20000 characters." }, 400);
      const { data, error } = await client.from("conversation_messages").insert({
        user_id: userId,
        conversation_id: payload.conversation_id,
        role,
        content,
      }).select("id,conversation_id,role,content,created_at").single();
      if (error) return json({ error: "Could not save conversation message." }, 500);
      return json({ data }, 201);
    }

    case "google.action":
      return await proxyFunction("google-calendar", payload, authorization);

    case "voice.generate":
      return json({ error: "Server-side voice generation is disabled to keep Jeeves free.", code: "FEATURE_DISABLED" }, 501);

    default:
      return json({ error: "Unknown action.", supported_actions: [
        "system.status", "ai.chat", "health.sync", "health.notify", "health.records.list",
        "tasks.list", "tasks.create", "tasks.update", "tasks.delete",
        "memories.list", "memories.create", "memories.delete",
        "conversations.list", "conversations.create",
        "conversations.messages.list", "conversations.messages.create",
        "google.action", "voice.generate",
      ] }, 404);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, null);
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Sign in required." }, 401, origin);

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large." }, 413, origin);
    }
    let body: JsonObject;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!isObject(parsed)) throw new Error("Invalid request");
      body = parsed;
    } catch {
      return json({ error: "Invalid JSON request body." }, 400, origin);
    }

    const action = typeof body.action === "string" ? body.action : "";
    if (!action || action.length > 80) return json({ error: "A valid action is required." }, 400, origin);
    const payload = body.payload === undefined ? {} : body.payload;
    if (!isObject(payload)) return json({ error: "payload must be a JSON object." }, 400, origin);

    const client = userClient(authorization);
    const { data: { user }, error } = await client.auth.getUser(match[1]);
    if (error || !user) return json({ error: "Invalid or expired session." }, 401, origin);

    const result = await dispatch(action, payload, client, user.id, authorization);
    const headers = new Headers(result.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    return new Response(result.body, { status: result.status, headers });
  } catch (error) {
    console.error("jeeves-api error:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Jeeves API request failed. Please try again." }, 500, origin);
  }
});
