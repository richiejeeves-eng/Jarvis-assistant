import { readFileSync } from "node:fs";

const gateway = readFileSync("supabase/functions/jeeves-api/index.ts", "utf8");
const docs = readFileSync("docs/API.md", "utf8");
const openapi = readFileSync("docs/openapi.yaml", "utf8");
const failures = [];

const expectedRoutes = [
  '"/v1/brain": "jeeves-brain"',
  '"/v1/google": "google-calendar"',
  '"/v1/health/sync": "health-sync"',
  '"/v1/health/notify": "health-sync-notify"',
];
for (const route of expectedRoutes) {
  if (!gateway.includes(route)) failures.push("Gateway missing route mapping: " + route);
}
for (const table of ["tasks", "memories", "conversations", "conversation_messages", "health_records"]) {
  if (!gateway.includes('"'+table+'"')) failures.push("Gateway table allowlist missing: " + table);
  if (!docs.includes("/v1/data/" + table)) failures.push("API docs missing data route: " + table);
}
if (!gateway.includes('req.headers.get("Authorization")')) failures.push("Gateway must require Authorization header");
if (!gateway.includes("auth.getUser")) failures.push("Gateway must validate user JWT");
if (!gateway.includes("AbortSignal.timeout")) failures.push("Gateway upstream requests must have timeouts");
if (!gateway.includes("FEATURE_DISABLED")) failures.push("Voice must remain disabled until a free provider is verified");
if (gateway.includes("SUPABASE_SERVICE_ROLE_KEY")) failures.push("Gateway must not use a service-role key");
if (!openapi.includes("openapi: 3.1.0")) failures.push("OpenAPI 3.1 document missing");
if (!openapi.includes("/v1/data/{table}:")) failures.push("OpenAPI data resource route missing");
if (!docs.includes("not been deployed")) failures.push("Docs must state this API is not deployed");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Jeeves API route, auth, data allowlist and documentation checks passed.");
}
