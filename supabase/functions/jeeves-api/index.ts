import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const API_VERSION = "1.0.0";
const MAX_FUNCTION_BODY_BYTES = 4_500_000;
const MAX_DATA_BODY_BYTES = 1_000_000;

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
  auth: { authorization: string; publishableKey: string; supabaseUrl: string },
  origin: string | null,
  requestId: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "This endpoint accepts POST only.", code: "METHOD_NOT_ALLOWED" }, 405, origin, requestId);
  }

  let body: string;
  try {
    body = await readBody(req, MAX_FUNCTION_BODY_BYTES);
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
  auth: { authorization: string; publishableKey: string; supabaseUrl: string },
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
  if (search.length > 4096) {
    return json({ error: "Query string is too long.", code: "QUERY_TOO_LARGE" }, 414, origin, requestId);
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

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin, requestId) });
  }

  const url = new URL(req.url);
  const path = routePath(url);

  if (req.method === "GET" && (path === "/v1" || path === "/v1/")) {
    const auth = await authenticate(req, origin, requestId);
    if ("error" in auth) return auth.error;
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
  if ("error" in auth) return auth.error;

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
});
