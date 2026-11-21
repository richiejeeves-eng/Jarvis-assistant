import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const APP_URL = "https://richiejeeves-eng.github.io/Jeeves-assistant/";
const REDIRECT_URI = Deno.env.get("SUPABASE_URL") + "/functions/v1/google-calendar";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const GOOGLE_SCOPES = [CALENDAR_SCOPE, TASKS_SCOPE, GMAIL_READ_SCOPE, GMAIL_SCOPE, DRIVE_SCOPE].join(" ");
const allowedOrigins = new Set([
  "https://richiejeeves-eng.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function headers(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://richiejeeves-eng.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
}

async function signState(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(requiredEnv("GOOGLE_OAUTH_STATE_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(signature));
}

async function verifyState(payload: string, signature: string): Promise<boolean> {
  const expected = await signState(payload);
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function encryptToken(value: string): Promise<string> {
  const secret = requiredEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const raw = new TextEncoder().encode(secret);
  if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be exactly 32 UTF-8 bytes.");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return b64url(combined);
}

async function decryptToken(value: string): Promise<string> {
  const secret = requiredEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const raw = new TextEncoder().encode(secret);
  if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be exactly 32 UTF-8 bytes.");
  const combined = fromB64url(value);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(plain);
}

function adminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticatedUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function redirectResult(status: string, reason?: string) {
  const target = new URL(APP_URL);
  target.searchParams.set("calendar", status);
  if (reason) target.searchParams.set("reason", reason.slice(0, 80));
  return Response.redirect(target.toString(), 302);
}

async function handleCallback(url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (url.searchParams.get("error")) return redirectResult("denied");
  if (!code || !state) return redirectResult("error", "invalid_callback");

  const [payloadPart, signature] = state.split(".");
  if (!payloadPart || !signature) return redirectResult("error", "invalid_state");
  let payload: { uid: string; nonce: string; exp: number };
  try {
    if (!await verifyState(payloadPart, signature)) return redirectResult("error", "invalid_state");
    payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadPart)));
  } catch {
    return redirectResult("error", "invalid_state");
  }
  if (!payload.uid || !payload.nonce || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
    return redirectResult("error", "expired_state");
  }

  const admin = adminClient();
  const { data: stateRow, error: stateError } = await admin.from("google_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("nonce", payload.nonce)
    .eq("user_id", payload.uid)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("nonce")
    .maybeSingle();
  if (stateError || !stateRow) return redirectResult("error", "state_already_used_or_expired");

  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.log("Google OAuth token exchange failed:", tokenResponse.status, "reason:", String(tokenData.error || "unknown"), "description:", String(tokenData.error_description || "none").slice(0, 240));
    return redirectResult("error", "token_exchange_failed");
  }

  const { data: existing } = await admin.from("google_calendar_tokens")
    .select("refresh_token_ciphertext")
    .eq("user_id", payload.uid)
    .maybeSingle();
  const refreshToken = tokenData.refresh_token
    ? await encryptToken(tokenData.refresh_token)
    : existing?.refresh_token_ciphertext;
  if (!refreshToken) return redirectResult("error", "missing_refresh_token_reconnect");

  const { error: saveError } = await admin.from("google_calendar_tokens").upsert({
    user_id: payload.uid,
    access_token_ciphertext: await encryptToken(tokenData.access_token),
    refresh_token_ciphertext: refreshToken,
    expires_at: new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString(),
    scopes: String(tokenData.scope || GOOGLE_SCOPES).split(" "),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (saveError) {
    console.log("Google token storage failed:", saveError.message);
    return redirectResult("error", "secure_storage_failed");
  }
  await admin.from("google_oauth_states").delete().lt("expires_at", new Date().toISOString());
  return redirectResult("connected");
}

async function getAccessToken(userId: string) {
  const admin = adminClient();
  const { data: row, error } = await admin.from("google_calendar_tokens")
    .select("access_token_ciphertext, refresh_token_ciphertext, expires_at, scopes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) throw new Error("Google Calendar is not connected.");
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) return await decryptToken(row.access_token_ciphertext);

  const refreshToken = await decryptToken(row.refresh_token_ciphertext);
  const refreshed = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await refreshed.json();
  if (!refreshed.ok || !data.access_token) throw new Error("Google authorisation expired. Reconnect Google Calendar.");
  await admin.from("google_calendar_tokens").update({
    access_token_ciphertext: await encryptToken(data.access_token),
    expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return data.access_token as string;
}

async function handleAction(req: Request, origin: string | null) {
  const user = await authenticatedUser(req);
  if (!user) return json({ error: "Please sign in to Jeeves." }, 401, origin);
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const admin = adminClient();

  if (action === "authorize") {
    const clientId = requiredEnv("GOOGLE_CLIENT_ID");
    requiredEnv("GOOGLE_CLIENT_SECRET");
    requiredEnv("GOOGLE_OAUTH_STATE_SECRET");
    requiredEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
    const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
    const nonce = b64url(nonceBytes);
    const payload = b64url(new TextEncoder().encode(JSON.stringify({
      uid: user.id, nonce, exp: Date.now() + 10 * 60 * 1000,
    })));
    const state = payload + "." + await signState(payload);
    const { error } = await admin.from("google_oauth_states").insert({
      nonce, user_id: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error("Could not initialise secure Google authorisation.");
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return json({ url: authUrl.toString() }, 200, origin);
  }

  if (action === "status") {
    const { data, error } = await admin.from("google_calendar_tokens")
      .select("updated_at, scopes")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return json({ connected: !!data, tasks_enabled: !!data?.scopes?.includes(TASKS_SCOPE), gmail_enabled: !!data?.scopes?.includes(GMAIL_SCOPE) && !!data?.scopes?.includes(GMAIL_READ_SCOPE), drive_enabled: !!data?.scopes?.includes(DRIVE_SCOPE), updated_at: data?.updated_at || null, scopes: data?.scopes || [] }, 200, origin);
  }

  if (action === "disconnect") {
    const { data } = await admin.from("google_calendar_tokens")
      .select("refresh_token_ciphertext").eq("user_id", user.id).maybeSingle();
    if (data?.refresh_token_ciphertext) {
      try {
        const refresh = await decryptToken(data.refresh_token_ciphertext);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refresh }),
        });
      } catch { /* local deletion remains authoritative */ }
    }
    const { error } = await admin.from("google_calendar_tokens").delete().eq("user_id", user.id);
    if (error) throw error;
    return json({ disconnected: true }, 200, origin);
  }

  const accessToken = await getAccessToken(user.id);
  if (action === "gmailMessages" || action === "driveFiles") {
    const { data: tokenRow, error: tokenError } = await admin.from("google_calendar_tokens")
      .select("scopes").eq("user_id", user.id).maybeSingle();
    if (tokenError) throw tokenError;
    const neededScope = action === "gmailMessages" ? GMAIL_READ_SCOPE : DRIVE_SCOPE;
    if (!tokenRow?.scopes?.includes(neededScope)) return json({ error: "Permission missing. Reconnect Google and grant the requested access." }, 403, origin);
    if (action === "gmailMessages") {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10", { headers: { Authorization: "Bearer " + accessToken } });
      const data = await response.json();
      if (!response.ok) throw new Error("Gmail could not list messages (" + response.status + "). Check that Gmail API is enabled.");
      const messages = [];
      for (const item of (data.messages || []).slice(0, 10)) {
        const detailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(item.id) + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date", { headers: { Authorization: "Bearer " + accessToken } });
        const detail = await detailResponse.json();
        if (!detailResponse.ok) continue;
        const headers = detail.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || "";
        messages.push({ id: detail.id, threadId: detail.threadId, subject: getHeader("Subject"), from: getHeader("From"), date: getHeader("Date"), snippet: detail.snippet || "" });
      }
      return json({ messages }, 200, origin);
    }
    const params = new URLSearchParams({ pageSize: "20", orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
    const response = await fetch("https://www.googleapis.com/drive/v3/files?" + params, { headers: { Authorization: "Bearer " + accessToken } });
    const data = await response.json();
    if (!response.ok) throw new Error("Google Drive could not list files (" + response.status + "). Check that Drive API is enabled.");
    return json({ files: data.files || [] }, 200, origin);
  }

  if (action === "gmailReply") {
    const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
    const replyText = typeof body.body === "string" ? body.body.trim() : "";
    if (!messageId || !replyText) return json({ error: "Choose an email and enter a reply before sending." }, 400, origin);
    if (replyText.length > 20000) return json({ error: "Reply is too long (20,000 character limit)." }, 400, origin);
    const { data: tokenRow, error: tokenError } = await admin.from("google_calendar_tokens").select("scopes").eq("user_id", user.id).maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow?.scopes?.includes(GMAIL_SCOPE)) return json({ error: "Gmail sending permission is missing. Reconnect Gmail and approve the new sending permission." }, 403, origin);
    const originalResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(messageId) + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References", { headers: { Authorization: "Bearer " + accessToken } });
    const original = await originalResponse.json();
    if (!originalResponse.ok) throw new Error("Could not load the original email (" + originalResponse.status + ").");
    const headers = original.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || "";
    const recipient = getHeader("From");
    if (!recipient) throw new Error("The original email has no sender address to reply to.");
    const originalSubject = getHeader("Subject") || "";
    const subject = /^re:/i.test(originalSubject) ? originalSubject : "Re: " + originalSubject;
    const originalMessageId = getHeader("Message-ID");
    const references = [getHeader("References"), originalMessageId].filter(Boolean).join(" ").trim();
    const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
    const mime = ["To: " + clean(recipient), "Subject: " + clean(subject), ...(originalMessageId ? ["In-Reply-To: " + clean(originalMessageId)] : []), ...(references ? ["References: " + clean(references)] : []), "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", replyText.replace(/\r?\n/g, "\r\n")].join("\r\n");
    const bytes = new TextEncoder().encode(mime); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    const raw = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ raw, threadId: original.threadId }) });
    const sent = await sendResponse.json();
    if (!sendResponse.ok) throw new Error("Gmail could not send the reply (" + sendResponse.status + "): " + String(sent.error?.message || "Unknown error"));
    return json({ sent: true, message_id: sent.id, thread_id: sent.threadId }, 200, origin);
  }
  if (action === "syncTasks") {
    const { data: tokenRow, error: tokenError } = await admin.from("google_calendar_tokens")
      .select("scopes").eq("user_id", user.id).maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow?.scopes?.includes(TASKS_SCOPE)) {
      return json({ error: "Google Tasks permission is missing. Choose Connect & grant Google Tasks access first." }, 403, origin);
    }
    const listsResponse = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1000", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    const listsData = await listsResponse.json();
    if (!listsResponse.ok) throw new Error("Google Task lists could not be loaded (" + listsResponse.status + ").");
    let imported = 0;
    for (const taskList of (listsData.items || [])) {
      let pageToken = "";
      do {
        const params = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true" });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await fetch("https://tasks.googleapis.com/tasks/v1/lists/" + encodeURIComponent(taskList.id) + "/tasks?" + params, {
          headers: { Authorization: "Bearer " + accessToken },
        });
        const data = await response.json();
        if (!response.ok) throw new Error("Google Tasks could not be loaded (" + response.status + ").");
        const rows = (data.items || []).filter((task: any) => !task.deleted && task.id).map((task: any) => ({
          user_id: user.id,
          title: String(task.title || "Untitled Google task").slice(0, 500),
          description: task.notes ? String(task.notes).slice(0, 4000) : null,
          due_at: task.due ? new Date(task.due).toISOString() : null,
          status: task.status === "completed" ? "done" : "pending",
          source: "google_tasks",
          google_task_id: task.id,
          google_tasklist_id: taskList.id,
          group_name: String(taskList.title || "Google Tasks").slice(0, 200),
        }));
        if (rows.length) {
          const { error: upsertError } = await admin.from("tasks").upsert(rows, {
            onConflict: "user_id,google_tasklist_id,google_task_id",
          });
          if (upsertError) throw new Error("Google Tasks import failed: " + upsertError.message);
          imported += rows.length;
        }
        pageToken = data.nextPageToken || "";
      } while (pageToken);
    }
    return json({ synced: true, imported }, 200, origin);
  }

  if (action === "createTask") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (!title) return json({ error: "Enter a task title." }, 400, origin);
    if (title.length > 500 || notes.length > 4000) return json({ error: "Task details are too long." }, 400, origin);
    const { data: tokenRow, error: tokenError } = await admin.from("google_calendar_tokens").select("scopes").eq("user_id", user.id).maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow?.scopes?.includes(TASKS_SCOPE)) return json({ error: "Google Tasks permission is missing. Reconnect and grant Google Tasks access." }, 403, origin);
    const listsResponse = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100", { headers: { Authorization: "Bearer " + accessToken } });
    const listsData = await listsResponse.json();
    if (!listsResponse.ok) throw new Error("Google Task lists could not be loaded (" + listsResponse.status + ").");
    const taskList = (listsData.items || [])[0];
    if (!taskList?.id) throw new Error("No Google Tasks list exists in this account.");
    const response = await fetch("https://tasks.googleapis.com/tasks/v1/lists/" + encodeURIComponent(taskList.id) + "/tasks", {
      method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ title, ...(notes ? { notes } : {}) }),
    });
    const task = await response.json();
    if (!response.ok) throw new Error("Google task could not be created (" + response.status + ").");
    const { data: saved, error: saveError } = await admin.from("tasks").upsert({
      user_id: user.id, title: task.title || title, description: task.notes || null, due_at: null, status: "pending",
      source: "google_tasks", google_task_id: task.id, google_tasklist_id: taskList.id, group_name: taskList.title || "Google Tasks",
    }, { onConflict: "user_id,google_tasklist_id,google_task_id" }).select("id,title,due_at,source,google_task_id,google_tasklist_id").single();
    if (saveError) throw new Error("Google task was created but Jeeves could not save its link: " + saveError.message);
    return json({ created: true, task: saved }, 200, origin);
  }

  if (action === "deleteTask") {
    const rowId = typeof body.task_id === "string" ? body.task_id : "";
    if (!rowId) return json({ error: "Task identifier is required." }, 400, origin);
    const { data: taskRow, error: taskError } = await admin.from("tasks")
      .select("id,google_task_id,google_tasklist_id,source").eq("id", rowId).eq("user_id", user.id).maybeSingle();
    if (taskError) throw taskError;
    if (!taskRow) return json({ error: "Task not found." }, 404, origin);
    if (taskRow.google_task_id && taskRow.google_tasklist_id) {
      const response = await fetch("https://tasks.googleapis.com/tasks/v1/lists/" + encodeURIComponent(taskRow.google_tasklist_id) + "/tasks/" + encodeURIComponent(taskRow.google_task_id), {
        method: "DELETE", headers: { Authorization: "Bearer " + accessToken },
      });
      if (!response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error("Google task could not be deleted (" + response.status + "): " + detail.slice(0, 180));
      }
    } else {
      return json({ error: "This task is not linked to Google Tasks yet. Sync Google Tasks before deleting it here." }, 409, origin);
    }
    const { error: deleteError } = await admin.from("tasks").delete().eq("id", rowId).eq("user_id", user.id);
    if (deleteError) throw deleteError;
    return json({ deleted: true, task_id: rowId }, 200, origin);
  }

  if (action === "completeTask") {
    const taskId = typeof body.google_task_id === "string" ? body.google_task_id : "";
    const taskListId = typeof body.google_tasklist_id === "string" ? body.google_tasklist_id : "";
    if (!taskId || !taskListId) return json({ error: "Google task identifiers are required." }, 400, origin);
    const response = await fetch("https://tasks.googleapis.com/tasks/v1/lists/" + encodeURIComponent(taskListId) + "/tasks/" + encodeURIComponent(taskId), {
      method: "PATCH",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed", completed: new Date().toISOString() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error("Google task could not be marked complete (" + response.status + ").");
    return json({ completed: true, task_id: data.id }, 200, origin);
  }

  if (action === "events") {
    const rangeStart = typeof body.timeMin === "string" && Number.isFinite(Date.parse(body.timeMin)) ? new Date(body.timeMin) : new Date();
    const rangeEnd = typeof body.timeMax === "string" && Number.isFinite(Date.parse(body.timeMax)) ? new Date(body.timeMax) : new Date(Date.now() + 90 * 86400000);
    if (rangeEnd <= rangeStart || rangeEnd.getTime() - rangeStart.getTime() > 370 * 86400000) throw new Error("Invalid calendar date range.");
    const params = new URLSearchParams({
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      maxResults: "250",
      singleEvents: "true",
      orderBy: "startTime",
    });
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    const data = await response.json();
    if (!response.ok) throw new Error("Google Calendar could not return events (" + response.status + ").");
    const events = (data.items || []).map((event: any) => ({
      id: event.id,
      summary: event.summary || "(Untitled event)",
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      location: event.location || null,
      htmlLink: event.htmlLink || null,
    }));
    return json({ events }, 200, origin);
  }

  if (action === "create") {
    const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 200) : "";
    const start = typeof body.start === "string" ? body.start : "";
    const end = typeof body.end === "string" ? body.end : "";
    if (!summary || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)) {
      return json({ error: "Provide an event title and valid start/end times; end must be after start." }, 400, origin);
    }
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        start: { dateTime: start },
        end: { dateTime: end },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error("Google Calendar could not create the event (" + response.status + ").");
    return json({ created: true, event: { id: data.id, summary: data.summary, htmlLink: data.htmlLink } }, 200, origin);
  }

  return json({ error: "Unsupported Google Calendar action." }, 400, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
      return await handleCallback(url);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
    return await handleAction(req, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.log("Google Calendar integration error:", message);
    const status = message.startsWith("Missing server configuration:") ? 503 : 400;
    return json({ error: message }, status, origin);
  }
});
