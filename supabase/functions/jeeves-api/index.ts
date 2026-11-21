import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const API_VERSION = "1.0.0";
const MAX_FUNCTION_BODY_BYTES = 4_500_000;
const MAX_HEALTH_SYNC_BODY_BYTES = 512_000;
const MAX_DATA_BODY_BYTES = 1_000_000;
const MAX_DATA_ROWS = 100;
const CONFIRMABLE_TABLES = new Set(["tasks", "memories"]);

const ALLOWED_ORIGINS = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const FUNCTION_ROUTES: Record<string, string> = {
  "/v1/brain": "jeeves-brain",
  "/v1/google": "google-calendar",
  "/v1/health/sync": "health-sync",
  "/v1/health/notify": "health-sync-notify",
};

const DATA_TABLES = new Set([
  "tasks",
  "memories",
  "conversations",
  "conversation_messages",
  "health_records",
]);

function corsHeaders(origin: string | null, requestId: string): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, accept, prefer, range, range-unit, if-match, if-none-match",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Request-Id": requestId,
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  requestId: string,
): Response {
  const headers = corsHeaders(origin, requestId);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
}

function routePath(url: URL): string {
  const marker = "/functions/v1/jeeves-api";
  const index = url.pathname.indexOf(marker);
  if (index < 0) return "/";
  return url.pathname.slice(index + marker.length) || "/";
}

async function readBody(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  const body = await req.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  return body;
}

async function authenticate(req: Request, origin: string | null, requestId: string) {
  const authorization = req.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      error: json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, 401, origin, requestId),
    };
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const publishableKey = requiredEnv("SUPABASE_ANON_KEY");
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) {
    return {
      error: json({ error: "Invalid or expired session.", code: "AUTH_INVALID" }, 401, origin, requestId),
    };
  }
  return { authorization, publishableKey, supabaseUrl, userId: data.user.id };
}

async function forwardFunction(
  req: Request,
  functionName: string,
  auth: { authorization: string; publishableKey: string; supabaseUrl: string; userId: string },
  origin: string | null,
  requestId: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "This endpoint accepts POST only.", code: "METHOD_NOT_ALLOWED" }, 405, origin, requestId);
  }

  let body: string;
  try {
    body = await readBody(req, functionName === "health-sync" ? MAX_HEALTH_SYNC_BODY_BYTES : MAX_FUNCTION_BODY_BYTES);
  } catch {
    return json({ error: "Request body is too large.", code: "BODY_TOO_LARGE" }, 413, origin, requestId);
  }

  const target = new URL("/functions/v1/" + functionName, auth.supabaseUrl);
  const headers = new Headers({
    Authorization: auth.authorization,
    apikey: auth.publishableKey,
    "Content-Type": req.headers.get("Content-Type") || "application/json",
  });

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const responseHeaders = corsHeaders(origin, requestId);
    responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Jeeves API function proxy failed:", functionName, String(error));
    return json({ error: "Upstream service is temporarily unavailable.", code: "UPSTREAM_UNAVAILABLE" }, 502, origin, requestId);
  }
}

async function forwardData(
  req: Request,
  table: string,
  auth: { authorization: string; publishableKey: string; supabaseUrl: string; userId: string },
  origin: string | null,
  requestId: string,
  search: string,
): Promise<Response> {
  if (!DATA_TABLES.has(table)) {
    return json({ error: "Data resource not found.", code: "RESOURCE_NOT_FOUND" }, 404, origin, requestId);
  }
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return json({ error: "Unsupported data method.", code: "METHOD_NOT_ALLOWED" }, 405, origin, requestId);
  }
  if (table === "health_records" && req.method !== "GET") {
    return json({ error: "Health records are read-only through this route; use the validated health sync endpoint to write records.", code: "READ_ONLY_RESOURCE" }, 405, origin, requestId);
  }

  // PATCH and DELETE must target exactly one UUID primary key. RLS remains
  // mandatory, but it is not a substitute for preventing accidental bulk writes.
  if (req.method === "PATCH" || req.method === "DELETE") {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const ids = params.getAll("id");
    if (ids.length !== 1 || !/^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ids[0])) {
      return json({
        error: "Mutations require exactly one id=eq.<uuid> selector. Bulk mutations are disabled.",
        code: "MUTATION_ID_REQUIRED",
      }, 400, origin, requestId);
    }
  }
  if (search.length > 4096) {
    return json({ error: "Query string is too long.", code: "QUERY_TOO_LARGE" }, 414, origin, requestId);
  }
  if (req.method === "GET") {
    const params = new URLSearchParams(search);
    const requestedLimit = Number(params.get("limit"));
    const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(MAX_DATA_ROWS, Math.floor(requestedLimit))
      : MAX_DATA_ROWS;
    params.set("limit", String(safeLimit));
    search = "?" + params.toString();
  }

  let body: string | undefined;
  if (req.method === "POST" || req.method === "PATCH") {
    const contentType = req.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json({ error: "Data writes must use application/json.", code: "UNSUPPORTED_MEDIA_TYPE" }, 415, origin, requestId);
    }
    try {
      body = await readBody(req, MAX_DATA_BODY_BYTES);
    } catch {
      return json({ error: "Data request body is too large.", code: "BODY_TOO_LARGE" }, 413, origin, requestId);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return json({ error: "Data writes require valid JSON.", code: "INVALID_JSON" }, 400, origin, requestId);
    }
    const rows = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
    if (!rows.length || !rows.every(isRecord)) {
      return json({ error: "Data writes must contain a JSON object or array of objects.", code: "INVALID_DATA_SHAPE" }, 400, origin, requestId);
    }
    for (const row of rows) {
      if (row.user_id !== undefined && row.user_id !== auth.userId) {
        return json({ error: "user_id cannot be changed by the client.", code: "USER_SCOPE_VIOLATION" }, 403, origin, requestId);
      }
      delete row.user_id;
      if (req.method === "POST" && CONFIRMABLE_TABLES.has(table)) {
        if (row.confirmed !== true) {
          return json({ error: "Explicit confirmed: true is required to create tasks or memories.", code: "EXPLICIT_CONFIRMATION_REQUIRED" }, 403, origin, requestId);
        }
        delete row.confirmed;
        if (table === "memories" && (typeof row.content !== "string" || !row.content.trim() || row.content.length > 2000)) {
          return json({ error: "Memory content must be 1 to 2000 characters.", code: "INVALID_MEMORY_CONTENT" }, 400, origin, requestId);
        }
        if (table === "tasks" && (typeof row.title !== "string" || !row.title.trim() || row.title.length > 180)) {
          return json({ error: "Task title must be 1 to 180 characters.", code: "INVALID_TASK_TITLE" }, 400, origin, requestId);
        }
      }
    }
    body = JSON.stringify(parsedBody);
  }

  const target = new URL("/rest/v1/" + table + search, auth.supabaseUrl);
  const headers = new Headers({
    Authorization: auth.authorization,
    apikey: auth.publishableKey,
    Accept: req.headers.get("Accept") || "application/json",
  });
  for (const name of ["Content-Type", "Prefer", "Range", "Range-Unit", "If-Match", "If-None-Match"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const requestedRange = req.headers.get("Range");
  const rangeMatch = requestedRange?.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const rangeStart = Number(rangeMatch[1]);
    const rangeEnd = Math.min(Number(rangeMatch[2]), rangeStart + MAX_DATA_ROWS - 1);
    headers.set("Range", rangeStart + "-" + rangeEnd);
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const responseHeaders = corsHeaders(origin, requestId);
    for (const name of ["Content-Type", "Content-Range", "Preference-Applied", "Location", "ETag"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Jeeves API data proxy failed:", table, String(error));
    return json({ error: "Data service is temporarily unavailable.", code: "DATA_UNAVAILABLE" }, 502, origin, requestId);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const requestId = crypto.randomUUID();

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, requestId) });
    }

    const url = new URL(req.url);
    const path = routePath(url);

    if (req.method === "GET" && (path === "/v1" || path === "/v1/")) {
      const auth = await authenticate(req, origin, requestId);
      if ("error" in auth) return auth.error ?? json({ error: "Authentication failed.", code: "AUTH_INVALID" }, 401, origin, requestId);
      return json({
        name: "Jeeves API",
        version: API_VERSION,
        authenticated: true,
        routes: {
          brain: "POST /v1/brain",
          google: "POST /v1/google",
          healthSync: "POST /v1/health/sync",
          healthNotify: "POST /v1/health/notify",
          data: "GET|POST|PATCH|DELETE /v1/data/{tasks|memories|conversations|conversation_messages|health_records}",
          voice: "disabled until a verified no-cost voice provider is configured",
        },
        security: {
          userJwtRequired: true,
          rowLevelSecurity: "enforced by Supabase",
          serviceRoleKeyExposed: false,
        },
      }, 200, origin, requestId);
    }

    const auth = await authenticate(req, origin, requestId);
    if ("error" in auth) return auth.error ?? json({ error: "Authentication failed.", code: "AUTH_INVALID" }, 401, origin, requestId);

    if (path === "/v1/voice") {
      return json({
        error: "Voice is disabled on the unified API until a verified no-cost provider is configured.",
        code: "FEATURE_DISABLED",
      }, 501, origin, requestId);
    }

    const functionName = FUNCTION_ROUTES[path];
    if (functionName) {
      return await forwardFunction(req, functionName, auth, origin, requestId);
    }

    const dataMatch = path.match(/^\/v1\/data\/([a-z_]+)$/);
    if (dataMatch) {
      return await forwardData(req, dataMatch[1], auth, origin, requestId, url.search);
    }

    return json({ error: "API route not found.", code: "NOT_FOUND" }, 404, origin, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Missing server configuration:")) {
      return json({ error: "Jeeves API is not configured.", code: "CONFIGURATION_ERROR" }, 503, origin, requestId);
    }
    console.error("Jeeves API request failed:", String(error));
    return json({ error: "Unexpected API error.", code: "INTERNAL_ERROR" }, 500, origin, requestId);
  }
});
