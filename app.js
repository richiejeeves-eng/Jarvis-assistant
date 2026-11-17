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

async function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || password.length < 6) {
    showStatus("Enter an email and a password of at least 6 characters.");
    return;
  }

  const { error } = await db.auth.signUp({
    email: email,
    password: password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  if (error) {
    showStatus("Sign up error: " + error.message);
    return;
  }

  showStatus("Check your email and tap the confirmation link, then come back here and tap Sign in.");
}

async function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await db.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    showStatus("Sign in error: " + error.message);
    return;
  }

  document.getElementById("password").value = "";
}

async function signOut() {
  await db.auth.signOut();
}

db.auth.onAuthStateChange((event, session) => {
  const account = document.getElementById("account");
  if (session) {
    showStatus("● Signed in as " + session.user.email);
    account.open = false;
  } else {
    showStatus("Not signed in. Tap to sign in.");
    account.open = true;
  }
  setTimeout(checkAlerts, 0);
});

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

async function showMemories() {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("memories")
    .select("content, category, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    addMessage("Memory error: " + error.message, "bot");
    return;
  }

  if (data.length === 0) {
    addMessage("JARVIS memory is empty.", "bot");
    return;
  }

  addMessage("JARVIS REMEMBERS:\n\n" + data
    .map(item => "• " + item.content)
    .join("\n"), "bot");
}

async function showTasks() {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_at")
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20);

  if (error) {
    addMessage("Task error: " + error.message, "bot");
    return;
  }

  if (data.length === 0) {
    addMessage("No pending tasks.", "bot");
    return;
  }

  const box = addMessage("YOUR TASKS", "bot");

  data.forEach(function (task) {
    const row = document.createElement("div");
    row.className = "taskrow";

    const label = document.createElement("span");
    let text = "• " + task.title;
    if (task.due_at) {
      text += "\n   due " + new Date(task.due_at).toLocaleString();
    }
    label.textContent = text;

    const doneButton = document.createElement("button");
    doneButton.textContent = "Done";
    doneButton.onclick = async function () {
      const { error: updateError } = await db
        .from("tasks")
        .update({ status: "done" })
        .eq("id", task.id);

      if (updateError) {
        addMessage("Task error: " + updateError.message, "bot");
        return;
      }

      label.className = "done";
      doneButton.remove();
      checkAlerts();
    };

    row.appendChild(label);
    row.appendChild(doneButton);
    box.appendChild(row);
  });

  scrollChat();
}

document.getElementById("command").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    send();
  }
});

setInterval(checkAlerts, 60000);

addMessage("JARVIS online. How can I help?", "bot");