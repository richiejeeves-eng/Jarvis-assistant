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

    const body = await req.json();
    if (!Array.isArray(body.records) || body.records.length > 500) {
      return new Response(JSON.stringify({ error: "records must be an array of at most 500 items" }), { status: 400, headers: cors });
    }
    const allowed = new Set(["steps", "heart_rate", "sleep", "weight", "body_fat", "blood_pressure", "active_calories"]);
    const rows = body.records.map((r: Record<string, unknown>) => {
      const recordType = String(r.record_type ?? "");
      const externalId = String(r.external_id ?? "");
      if (!allowed.has(recordType) || !externalId || externalId.length > 200) throw new Error("Invalid record");
      return {
        user_id: user.id,
        record_type: recordType,
        external_id: externalId,
        start_time: r.start_time ? new Date(String(r.start_time)).toISOString() : null,
        end_time: r.end_time ? new Date(String(r.end_time)).toISOString() : null,
        value: r.value && typeof r.value === "object" ? r.value : {},
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
