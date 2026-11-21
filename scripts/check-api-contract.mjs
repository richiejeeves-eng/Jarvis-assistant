import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const gateway = read("supabase/functions/jeeves-api/index.ts");
const client = read("api.js");
const docs = read("docs/JEEVES_API.md");
const speak = read("speak.js");
const integrations = read("integrations.js");
const fitness = read("fitness.js");
const android = read("android/app/src/main/java/com/richiejeeves/healthconnect/HealthSyncWorker.kt");
const spec = read("docs/openapi.yaml");
const failures = [];

const actions = [
  "system.status", "ai.chat", "health.sync", "health.notify", "health.records.list",
  "tasks.list", "tasks.create", "tasks.update", "tasks.delete",
  "memories.list", "memories.create", "memories.delete",
  "conversations.list", "conversations.create",
  "conversations.messages.list", "conversations.messages.create",
  "google.action", "voice.generate"
];
for (const action of actions) {
  if (!gateway.includes('"'+action+'"')) failures.push("Gateway missing action: " + action);
  if (!docs.includes("`"+action+"`")) failures.push("API docs missing action: " + action);
}
for (const mapping of [
  'brain: "ai.chat"',
  'calendar: "google.action"',
  'health: "health.sync"',
  'healthNotify: "health.notify"',
]) {
  if (!client.includes(mapping)) failures.push("Browser client missing service mapping: " + mapping);
}
if (!client.includes("body: { action: action, payload: payload || {} }")) failures.push("Browser client request envelope does not match gateway");
if (!gateway.includes("auth.getUser")) failures.push("Gateway must validate user JWT");
if (!gateway.includes('case "health.notify"')) failures.push("Gateway must route health notifications");
if (!gateway.includes('code: "FEATURE_DISABLED"')) failures.push("Server voice generation must remain disabled");
if (gateway.includes('proxyFunction("jeeves-voice"')) failures.push("Gateway must not call the paid voice provider");
if (gateway.includes("SUPABASE_SERVICE_ROLE_KEY")) failures.push("Gateway must not use the service-role key");
if (!gateway.includes(".eq(\"user_id\", userId)")) failures.push("Database actions must filter by authenticated user");
if (!speak.includes("speakWithBrowser(text, speaker)")) failures.push("App must retain free device speech");
if (speak.includes("ElevenLabs") || speak.includes("jeeves-api")) failures.push("App speech must not call an external paid voice API");
if (integrations.includes("name: \"ElevenLabs\"")) failures.push("Integrations UI must not advertise paid voice as active");
if (!fitness.includes('jeevesApi.call("healthNotify"')) failures.push("Browser health notifications must use the Jeeves API");
if (!android.includes('put("action", "health.sync")')) failures.push("Android health sync must use the Jeeves API action envelope");
if (!docs.includes("Source only; not deployed.")) failures.push("API docs must state that it is not deployed");
if (!spec.includes("openapi: 3.1.0")) failures.push("OpenAPI 3.1 specification missing");
if (!spec.includes("health.notify")) failures.push("OpenAPI health notification action missing");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Jeeves API actions, client envelope, free voice policy and documentation checks passed.");
}
