import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const gateway = read("supabase/functions/jeeves-api/index.ts");
const client = read("api.js");
const docs = read("docs/JEEVES_API.md");
const speak = read("speak.js");
const legacyVoice = read("supabase/functions/jeeves-voice/index.ts");
const integrations = read("integrations.js");
const fitness = read("fitness.js");
const android = read("android/app/src/main/java/com/richiejeeves/healthconnect/HealthSyncWorker.kt");
const spec = read("docs/openapi.yaml");
const failures = [];

for (const route of [
  '"/v1/brain": "jeeves-brain"',
  '"/v1/google": "google-calendar"',
  '"/v1/health/sync": "health-sync"',
  '"/v1/health/notify": "health-sync-notify"',
]) {
  if (!gateway.includes(route)) failures.push("Gateway missing function route: " + route);
}
for (const table of ["tasks", "memories", "conversations", "conversation_messages", "health_records"]) {
  if (!gateway.includes('"'+table+'"')) failures.push("Gateway table allowlist missing: " + table);
  if (!docs.includes("`"+table+"`")) failures.push("API docs missing data resource: " + table);
}
for (const route of [
  'brain: { path: "/v1/brain"',
  'calendar: { path: "/v1/google"',
  'health: { path: "/v1/health/sync"',
  'healthNotify: { path: "/v1/health/notify"',
  'voice: { path: "/v1/voice"',
]) {
  if (!client.includes(route)) failures.push("Browser API client missing route mapping: " + route);
}
if (!gateway.includes("auth.getUser")) failures.push("Gateway must validate user JWT");
if (!gateway.includes("CONFIRMABLE_TABLES")) failures.push("Task and memory creation must require explicit confirmation");
if (!gateway.includes("MAX_DATA_ROWS = 100")) failures.push("Generic data reads must be capped at 100 rows");
if (!gateway.includes("MAX_HEALTH_SYNC_BODY_BYTES = 512_000")) failures.push("Health sync request size must be capped at 512 KB");
if (!read("supabase/functions/health-sync/index.ts").includes("body.records.length > 100")) failures.push("Health sync batches must be capped at 100 records");
if (!gateway.includes('code: "MUTATION_ID_REQUIRED"') || !gateway.includes('params.getAll("id")')) failures.push("PATCH and DELETE must require exactly one UUID id selector");
if (!gateway.includes("Bulk mutations are disabled")) failures.push("Bulk data mutations must remain disabled");
if (client.includes("history: modelHistory") || client.includes("const modelHistory")) failures.push("Do not send unused conversation history to the AI gateway");
if (!docs.includes("exactly one UUID")) failures.push("API docs must describe single-row mutation selector");
if (!gateway.includes('code: "FEATURE_DISABLED"')) failures.push("Server voice generation must remain disabled");
if (gateway.includes('proxyFunction("jeeves-voice"')) failures.push("Gateway must not call paid voice provider");
if (legacyVoice.includes("ELEVENLABS_API_KEY") || legacyVoice.includes("api.elevenlabs.com")) failures.push("Legacy voice function must not call paid provider");
if (!legacyVoice.includes('code: "FEATURE_DISABLED"')) failures.push("Legacy voice function must be disabled");
if (gateway.includes("SUPABASE_SERVICE_ROLE_KEY")) failures.push("Gateway must not use service-role key");
if (!gateway.includes("user_id cannot be changed")) failures.push("Gateway must prevent user_id reassignment");
if (!gateway.includes("health_records") || !gateway.includes("READ_ONLY_RESOURCE")) failures.push("Health records must be read-only through generic data route");
if (!speak.includes("speakWithBrowser(text, speaker)")) failures.push("App must retain free device speech");
if (speak.includes("ElevenLabs") || speak.includes("jeeves-api")) failures.push("App speech must not call paid voice API");
if (integrations.includes('name: "ElevenLabs"')) failures.push("Integrations UI must not advertise paid voice as active");
if (!fitness.includes('jeevesApi.call("healthNotify"')) failures.push("Browser health notifications must use the Jeeves API");
if (!android.includes("/functions/v1/jeeves-api/v1/health/sync")) failures.push("Android health sync must use the Jeeves API");
if (!docs.includes("Source only; not deployed.")) failures.push("API docs must state that API is not deployed");
if (!docs.includes("100 rows per request")) failures.push("API docs must state the data read limit");
if (!spec.includes("openapi: 3.1.0")) failures.push("OpenAPI 3.1 specification missing");
for (const path of ["/v1/brain:", "/v1/google:", "/v1/health/sync:", "/v1/health/notify:", "/v1/data/{table}:"]) {
  if (!spec.includes(path)) failures.push("OpenAPI path missing: " + path);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Jeeves API routes, auth, RLS safeguards, free voice policy and OpenAPI checks passed.");
}
