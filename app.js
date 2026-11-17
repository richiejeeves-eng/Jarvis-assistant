const SUPABASE_URL = "https://aelsipdtezvhjkwsshqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_JbN0kUdtX6d5J8bWAPbz4w_syw2aG4K";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let history = [];

function showStatus(text) {
  document.getElementById("authstatus").textContent = text;
}

function scrollChat() {
  const chat = document.getElementById("chat");
  chat.scrollTop = chat.scrollHeight;
}

function addMessage(text, who) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  chat.appendChild(div);
  scrollChat();
  return div;
}

function addNote(text) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "note";
  div.textContent = text;
  chat.appendChild(div);
  scrollChat();
}

function makeButton(text, handler) {
  const button = document.createElement("button");
  button.textContent = text;
  button.onclick = handler;
  return button;
}

function clearChat() {
  document.getElementById("chat").textContent = "";
  history = [];
  addMessage("Chat cleared. How can I help?", "bot");
}

async function checkAlerts() {
  const banner = document.getElementById("alerts");

  const { data: sessionData } = await db.auth.getSession();
  if (!sessionData.session) {
    banner.style.display = "none";
    return;
  }

  const limit = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_at")
    .eq("status", "pending")
    .not("due_at", "is", null)
    .lte("due_at", limit)
    .order("due_at", { ascending: true })
    .limit(10);

  if (error || !data || data.length === 0) {
    banner.style.display = "none";
    return;
  }

  const now = new Date();
  const lines = data.map(function (task) {
    const due = new Date(task.due_at);
    const prefix = due < now ? "⚠ Overdue: " : "⏰ Due soon: ";
    return prefix + task.title + " (" + due.toLocaleString() + ")";
  });

  banner.textContent = lines.join("\n") + "\n(tap to manage tasks)";
  banner.style.display = "block";
}

async function requireSession() {
  const { data } = await db.auth.getSession();
  if (!data.session) {
    addMessage("Please sign in first (tap the Account bar at the top).", "bot");
    return false;
  }
  return true;
}

async function send() {
  const input = document.getElementById("command");
  const button = document.getElementById("sendbtn");
  const message = input.value.trim();

  if (!message) return;

  if (!(await requireSession())) return;

  addMessage(message, "user");
  input.value = "";
  button.disabled = true;

  const thinking = addMessage("JARVIS is thinking...", "bot");

  const { data, error } = await db.functions.invoke("jarvis-brain", {
    body: {
      message: message,
      history: history.slice(-10),
      now: new Date().toString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  });

  button.disabled = false;

  if (error) {
    let detail = error.message;
    try {
      const body = await error.context.json();
      if (body && body.error) detail = body.error;
    } catch (e) {}
    thinking.textContent = "AI error: " + detail;
    return;
  }

  thinking.textContent = data.reply;

  history.push({ role: "user", text: message });
  history.push({ role: "model", text: data.reply });
  history = history.slice(-10);

  if (data.saved) {
    addNote("💾 Saved to memory: " + data.saved);
  }

  if (data.task) {
    addNote("✅ Task added: " + data.task + " (tap Show tasks to see it)");
    checkAlerts();
  }

  scrollChat();
}