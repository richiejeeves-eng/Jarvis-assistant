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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — British male voice
const MODEL_ID = "eleven_multilingual_v2";

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401, origin);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Invalid or expired session." }, 401, origin);

    const { data: allowed, error: rateLimitError } = await supabase.rpc("consume_jeeves_voice_request");
    if (rateLimitError) {
      console.error("Voice rate limit check failed:", rateLimitError.message);
      return json({ error: "Voice service is temporarily unavailable." }, 503, origin);
    }
    if (allowed !== true) return json({ error: "Voice request limit reached. Please wait a minute." }, 429, origin);

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return json({ error: "Voice service is not configured." }, 503, origin);

    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 1200) return json({ error: "Text must be 1 to 1200 characters." }, 400, origin);

    // Voice IDs are constrained to safe identifier characters; API key remains server-side.
    const requestedVoice = typeof body.voice_id === "string" ? body.voice_id : DEFAULT_VOICE_ID;
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestedVoice)) return json({ error: "Invalid voice ID." }, 400, origin);

    const response = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + requestedVoice + "?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(25000),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("ElevenLabs request failed:", response.status, detail.slice(0, 500));
      return json({ error: "Voice generation failed. Check voice access and account credits." }, 502, origin);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("jeeves-voice error:", String(error));
    return json({ error: "Voice service error." }, 500, origin);
  }
});
