const ALLOWED_ORIGINS = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Server-side paid voice generation is intentionally disabled.
// Jeeves uses the browser/device SpeechSynthesis API instead.
Deno.serve((req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, null);
  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401, origin);
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);
  return json({
    error: "Server-side voice generation is disabled. Use free device speech instead.",
    code: "FEATURE_DISABLED",
  }, 501, origin);
});
