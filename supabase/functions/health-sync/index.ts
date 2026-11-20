import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers: cors });
    }
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(auth.slice(7));
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: cors });

    const rawBody = await req.text();
    if (rawBody.length > 2_000_000) {
      return new Response(JSON.stringify({ error: "Request body exceeds 2 MB" }), { status: 413, headers: cors });
    }
    const body = JSON.parse(rawBody);
    if (!body || !Array.isArray(body.records) || body.records.length > 500) {
      return new Response(JSON.stringify({ error: "records must be an array of at most 500 items" }), { status: 400, headers: cors });
    }
    const allowed = new Set(["steps", "heart_rate", "sleep", "weight", "body_fat", "blood_pressure", "active_calories"]);
    const rows = body.records.map((r: Record<string, unknown>) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("Each record must be an object");
      const recordType = typeof r.record_type === "string" ? r.record_type : "";
      const externalId = typeof r.external_id === "string" ? r.external_id.trim() : "";
      if (!allowed.has(recordType) || !externalId || externalId.length > 200) throw new Error("Invalid record type or external ID");
      const parseDate = (value: unknown, field: string) => {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value !== "string" || value.length > 50) throw new Error("Invalid " + field);
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid " + field);
        return parsed.toISOString();
      };
      if (!r.value || typeof r.value !== "object" || Array.isArray(r.value) ||
          JSON.stringify(r.value).length > 20_000) throw new Error("Invalid record value");
      const startTime = parseDate(r.start_time, "start_time");
      const endTime = parseDate(r.end_time, "end_time");
      if (startTime && endTime && new Date(endTime) < new Date(startTime)) throw new Error("end_time cannot precede start_time");
      return {
        user_id: user.id,
        record_type: recordType,
        external_id: externalId,
        start_time: startTime,
        end_time: endTime,
        value: r.value,
        source_app: typeof r.source_app === "string" ? r.source_app.slice(0, 200) : null,
        source_device: typeof r.source_device === "string" ? r.source_device.slice(0, 200) : null,
      };
    });
    if (!rows.length) return new Response(JSON.stringify({ synced: 0 }), { headers: cors });
    const { error } = await client.from("health_records").upsert(rows, {
      onConflict: "user_id,record_type,external_id",
    });
    if (error) throw error;
    return new Response(JSON.stringify({ synced: rows.length }), { headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Sync failed" }), { status: 400, headers: cors });
  }
});
