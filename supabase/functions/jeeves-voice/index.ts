const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — British male voice
const MODEL_ID = "eleven_multilingual_v2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return json({ error: "ELEVENLABS_API_KEY secret is not configured." }, 500);

    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 1200) return json({ error: "Text must be 1 to 1200 characters." }, 400);

    // Voice IDs are constrained to safe identifier characters; API key remains server-side.
    const requestedVoice = typeof body.voice_id === "string" ? body.voice_id : DEFAULT_VOICE_ID;
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestedVoice)) return json({ error: "Invalid voice ID." }, 400);

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
      return json({ error: "ElevenLabs request failed (" + response.status + "). Check API key, voice access and account credits." }, 502);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("jeeves-voice error:", String(error));
    return json({ error: "Voice service error." }, 500);
  }
});
