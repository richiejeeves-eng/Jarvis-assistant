import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://richiejeeves-eng.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemBytes(pem: string): Uint8Array {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function firebaseAccessToken(account: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)
  ));
  const assertion = unsigned + "." + base64url(signature);
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Firebase OAuth failed: " + JSON.stringify(data));
  return data.access_token as string;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: corsHeaders(origin) });
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers: corsHeaders(origin) });
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(authorization.slice(7));
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: corsHeaders(origin) });

    const accountText = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!accountText) throw new Error("Firebase service account secret is not configured.");
    const account = JSON.parse(accountText);
    const projectId = account.project_id;
    if (!projectId || !account.client_email || !account.private_key) throw new Error("Firebase service account JSON is incomplete.");

    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    if (!adminKey) throw new Error("Supabase service role key is unavailable.");
    const admin = createClient(url, adminKey);
    const { data: tokens, error: tokenError } = await admin
      .from("health_device_tokens").select("token").eq("user_id", user.id);
    if (tokenError) throw tokenError;
    if (!tokens?.length) return new Response(JSON.stringify({ sent: 0, message: "No registered Android devices yet." }), { headers: corsHeaders(origin) });

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    const accessToken = await firebaseAccessToken(account);
    const results = await Promise.all(tokens.map(async ({ token }: { token: string }) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            data: { action: "health_sync", request_id: requestId },
            android: { priority: "high", ttl: "60s" },
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && (response.status === 404 || response.status === 400) &&
          JSON.stringify(result).includes("UNREGISTERED")) {
        await admin.from("health_device_tokens").delete().eq("token", token);
      }
      return { ok: response.ok, result };
    }));
    const sent = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({ sent, total: results.length, results }), { headers: corsHeaders(origin) });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Notification failed" }), { status: 500, headers: corsHeaders(origin) });
  }
});
