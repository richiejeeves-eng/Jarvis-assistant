import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigins = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST required." }, 405, origin);

  const authorization = req.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!match) return json({ error: "Sign in required." }, 401, origin);

  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(match[1]);
    if (error || !data.user) return json({ error: "Invalid or expired session." }, 401, origin);

    return json({
      error: "Server-side voice generation is disabled to keep Jeeves free. Use browser or device speech instead.",
      code: "FEATURE_DISABLED",
    }, 501, origin);
  } catch (error) {
    console.error("jeeves-voice disabled endpoint auth failed:", String(error));
    return json({ error: "Voice service is unavailable." }, 503, origin);
  }
});
