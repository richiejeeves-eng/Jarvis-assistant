import { createClient } from "npm:@supabase/supabase-js@2.119.2";

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

const MODEL = "gemini-3.5-flash-lite";

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type HistoryItem = { role: string; text: string };

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const respond = (body: unknown, status = 200) => json(body, status, origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return respond({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respond({ error: "Sign in required" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return respond({ error: "Invalid or expired session" }, 401);

    const { data: allowed, error: rateLimitError } = await supabase.rpc("consume_jeeves_ai_request");
    if (rateLimitError) {
      console.log("AI rate limit check failed:", rateLimitError.message);
      return respond({ error: "AI service is temporarily unavailable. Please try again shortly." }, 503);
    }
    if (allowed !== true) return respond({ error: "Request limit reached. Please wait a minute before trying again." }, 429);

    const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!apiKey) {
      return respond({ error: "GEMINI_API_KEY secret is not set yet." }, 500);
    }

    const MAX_BODY_BYTES = 4_500_000;
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return respond({ error: "Request body is too large." }, 413);
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return respond({ error: "Request body is too large." }, 413);
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch (_error) {
      return respond({ error: "Invalid JSON request body." }, 400);
    }
    if (body.ping === true) return respond({ ok: true });
    const message = typeof body.message === "string" ? body.message.trim() : "";
    let imagePart: { inlineData: { mimeType: string; data: string } } | null = null;
    if (body.image !== undefined && body.image !== null) {
      const mime = body.image?.mime;
      const encoded = body.image?.data;
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime) ||
          typeof encoded !== "string" || encoded.length === 0 || encoded.length > 4_000_000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        return respond({ error: "Image must be a valid JPEG, PNG or WebP under 3 MB." }, 400);
      }
      imagePart = { inlineData: { mimeType: mime, data: encoded } };
    }
    const requestedAdvisers = Array.isArray(body.active_advisers) ? body.active_advisers : ["mind", "body", "soul"];
    const activeAdvisers = ["mind", "body", "soul"].filter((name) => requestedAdvisers.includes(name));
    if (!message || message.length > 2000) {
      return respond({ error: "Message must be 1 to 2000 characters." }, 400);
    }

    const nowText = typeof body.now === "string" ? body.now.slice(0, 100) : new Date().toISOString();
    const timezone = typeof body.timezone === "string" ? body.timezone.slice(0, 60) : "UTC";

    const rawHistory: HistoryItem[] = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const history = rawHistory
      .filter((h) =>
        h && (h.role === "user" || h.role === "model") &&
        typeof h.text === "string" && h.text.trim().length > 0
      )
      .map((h) => ({ role: h.role, parts: [{ text: h.text.slice(0, 2000) }] }));

    while (history.length > 0 && history[0].role !== "user") {
      history.shift();
    }

    // Do not retrieve or forward stored health records, memories, tasks, or feedback to Gemini.
    const sharedContext =
      "Current date and time for the user: " + nowText + " (timezone " + timezone + ").\\n" +
      "Treat the current request as the only user-provided context. Do not infer permission to save data or create tasks.";

    const mindPrompt = `You are MIND, Jeeves' independent Chief Intelligence Adviser.
Your domain is superior intellectual analysis: advanced reasoning, logic, science, mathematics, technology, AI, history, economics, philosophy, psychology, strategy, systems thinking and complex problem-solving.
Think rigorously. Challenge assumptions. Separate facts, inference and uncertainty. Identify options, trade-offs, risks and second-order effects. Never fabricate evidence. Be direct and intellectually honest.
You are an adviser, not the Chief of Staff. Assess the user's request from the perspective of intellect and strategy. If your domain is not materially relevant, say so briefly rather than forcing an opinion.
Return a concise assessment with: assessment, key reasoning, risks or uncertainties, and recommendation.
`;

    const bodyPrompt = `You are BODY, Jeeves' independent Chief Health and Human Performance Adviser.
Your domain is evidence-based health education, anatomy, physiology, exercise science, fitness, nutrition, sleep, recovery, prevention, healthy ageing and interpretation of health measurements.
Prioritise safety and credible evidence. Do not diagnose, prescribe, replace a clinician or overstate certainty. Flag urgent warning signs and recommend appropriate professional care. Avoid unsafe diets, extreme exercise and unverified treatments.
You are an adviser, not the Chief of Staff. Assess the user's request from the perspective of physical health and wellbeing. If health is not materially relevant, say so briefly rather than forcing an opinion.
Return a concise assessment with: assessment, evidence-based guidance, safety considerations, and recommendation.
`;

    const soulPrompt = `You are SOUL, Jeeves' independent Chief Spiritual and Personal Wisdom Adviser.
Your domain is spirituality, comparative religious and philosophical traditions, meaning, purpose, ethics, values, mindfulness, contemplation, self-awareness, compassion, forgiveness, gratitude, character and inner development.
Respect religious and non-religious worldviews. Never impose doctrine, claim supernatural authority or exploit vulnerability. Distinguish historical teachings, interpretations and established facts. Encourage independent thought, humility, compassion and personal responsibility.
You are an adviser, not the Chief of Staff. Assess the user's request from the perspective of meaning, values and inner wellbeing. If this domain is not materially relevant, say so briefly rather than forcing an opinion.
Return a concise assessment with: reflection, relevant principles, ethical considerations, and recommendation.
`;

    async function askGemini(systemInstruction: string, contents: any[], structured: boolean) {
      const generationConfig: Record<string, unknown> = {
        temperature: structured ? 0.35 : 0.45,
        maxOutputTokens: structured ? 700 : 300,
      };
      if (structured) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = {
          type: "OBJECT",
          properties: {
            reply: { type: "STRING" },
            speaker: { type: "STRING" },
            memory: { type: "STRING" },
            task_title: { type: "STRING" },
            task_due_at: { type: "STRING" },
          },
          required: ["reply", "speaker", "memory", "task_title", "task_due_at"],
          propertyOrdering: ["speaker", "task_title", "task_due_at", "memory", "reply"],
        };
      }
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig,
          }),
          signal: AbortSignal.timeout(45000),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error("Gemini error " + response.status + ": " + (data?.error?.message ?? "request failed"));
      }
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p: { text?: string }) => p.text ?? "").join("");
    }

    // One Gemini request per message keeps API usage aligned with the per-user request limit.
    const councilAdvice = [
      activeAdvisers.includes("mind") ? mindPrompt : "",
      activeAdvisers.includes("body") ? bodyPrompt : "",
      activeAdvisers.includes("soul") ? soulPrompt : "",
    ].filter(Boolean).join("\\n\\n") || "No specialist advisers selected; respond using broad general knowledge.";

    const chiefPrompt =
      "You are JEEVES, the Chief of Staff and principal personal assistant. You have broad general knowledge across everyday life, work, technology, research, planning and practical problem-solving. You coordinate three independent specialist advisers: MIND (intellect and strategy), BODY (health and physical wellbeing), and SOUL (spirituality, values and meaning). " +
      "Only the advisers selected for this request have contributed. If exactly ONE adviser is selected, speak directly to the user as that specialist in her own voice and first person; do not introduce yourself as Jeeves or refer to yourself in the third person. Keep her expert domain and warm, confident female persona. If zero or multiple advisers are selected, Jeeves speaks as Chief of Staff and synthesizes relevant advice. Do not invent advice from inactive advisers or merely concatenate reports. Reply in 1-3 short sentences. Be concise, clear, discreet and action-oriented. " +
      "Respect the selected autonomy level (" + String(body.mode ?? 3) + "): offer advice at Level 1, structured planning/accountability at Level 2, and operational briefs/drafts at Level 3. Never claim to have taken external actions without tool confirmation; external actions require permission. " +
      sharedContext +
      "\\n\\nSelected Council assessments:\\n" + councilAdvice +
      "\\n\\nReturn JSON. speaker: exactly one of 'jeeves', 'mind', 'body', or 'soul'; use the sole selected adviser when exactly one is active, otherwise 'jeeves'. reply: final answer to user, in the speaker voice described above, incorporating only relevant specialist advice. memory: ONE short durable fact/preference/goal from the latest user message (under 200 characters), or empty if none/already saved/question/small talk/to-do. Never save passwords, keys, card numbers or ID numbers. task_title: only if user explicitly asks for reminder/to-do, 2-6 words; otherwise empty. task_due_at: ISO 8601 with offset only when a due time was supplied; otherwise empty. You cannot mark tasks done; direct user to Show tasks.";

    const chiefParts: any[] = [{ text: message }];
    if (imagePart) chiefParts.push(imagePart);
    const chiefRaw = await askGemini(chiefPrompt, [{ role: "user", parts: chiefParts }], true);
    const raw = chiefRaw;

    let reply = "I couldn't format that response correctly. Please try again.";
    let memory = "";
    let taskTitle = "";
    let taskDue = "";
    try {
      const parsed = JSON.parse(raw);
      reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply : reply;
      memory = typeof parsed.memory === "string" ? parsed.memory.trim().slice(0, 300) : "";
      taskTitle = typeof parsed.task_title === "string" ? parsed.task_title.trim() : "";
      taskDue = typeof parsed.task_due_at === "string" ? parsed.task_due_at.trim() : "";
    } catch (_e) {
      console.log("could not parse JSON reply");
    }

    if (taskTitle.length > 80) {
      taskTitle = taskTitle.slice(0, 80);
    }
    const taskIntent = /\\b(?:remind me|set (?:a )?reminder|add (?:this )?(?:to-?do|task)|create (?:a )?(?:to-?do|task)|make (?:a )?(?:to-?do|task)|put (?:this )?on my (?:to-?do|task) list|don't let me forget|do not let me forget)\\b/i.test(message);
    const taskOptOut = /\\b(?:don't|do not|never)\\s+(?:create|add|make|set)\\s+(?:a )?(?:task|to-?do|reminder)\\b/i.test(message);
    if (!taskIntent || taskOptOut) { taskTitle = ""; taskDue = ""; }

    // Model output is never enough to create a durable memory: require explicit user intent.
    const memoryIntent = /\b(remember|save|store|keep in mind)\b/i.test(message);
    const memoryOptOut = /\b(?:don't|do not|never|not)\s+(?:ever\s+)?(?:remember|save|store|keep in mind)\b/i.test(message) ||
      /\b(?:don't|do not)\s+(?:want|need)\s+(?:you to\s+)?(?:remember|save|store)\b/i.test(message);
    const explicitlyAskedToRemember = memoryIntent && !memoryOptOut;
    if (!explicitlyAskedToRemember) memory = "";

    let saved = "";
    if (memory) {
      const { error: saveError } = await supabase
        .from("memories")
        .insert([{ content: memory, category: "auto" }]);
      if (saveError) {
        console.log("auto-save error:", saveError.message);
      } else {
        saved = memory;
      }
    }

    let taskAdded = "";
    if (taskTitle) {
      let dueIso: string | null = null;
      if (taskDue) {
        const d = new Date(taskDue);
        if (!isNaN(d.getTime())) dueIso = d.toISOString();
      }
      const { error: taskError } = await supabase
        .from("tasks")
        .insert([{ title: taskTitle, due_at: dueIso }]);
      if (taskError) {
        console.log("task error:", taskError.message);
      } else {
        taskAdded = taskTitle;
      }
    }

    let speaker = "jeeves";
    try { const parsedSpeaker = JSON.parse(raw); if (["mind", "body", "soul"].includes(parsedSpeaker.speaker)) speaker = parsedSpeaker.speaker; } catch (_e) {}
    return respond({ reply: reply || "(no reply)", speaker: speaker, saved: saved, task: taskAdded });
  } catch (e) {
    console.log("function error:", String(e));
    return respond({ error: "Server error: " + String(e) }, 500);
  }
});
