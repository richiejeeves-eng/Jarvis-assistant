// Jeeves Council autonomy selector — all three specialists remain active at every level.
const JEEVES_COUNCIL_LEVELS = {
  1: { name: "Adviser-led", label: "Level 1 · Adviser", description: "Council advises; user directs." },
  2: { name: "Organiser-led", label: "Level 2 · Organiser", description: "Council plans and tracks with approval." },
  3: { name: "Operations-led", label: "Level 3 · Operations", description: "Council prepares coordinated work for approval." }
};
window.jeevesModeLevel = Number(localStorage.getItem("jeeves-council-level") || 3);
window.jeevesMode = JEEVES_COUNCIL_LEVELS[window.jeevesModeLevel]?.name || "Operations-led";
function setAssistanceLevel(level) {
  const chosen = JEEVES_COUNCIL_LEVELS[Number(level)];
  if (!chosen) return;
  window.jeevesModeLevel = Number(level);
  window.jeevesMode = chosen.name;
  localStorage.setItem("jeeves-council-level", String(level));
  document.querySelectorAll(".level-btn").forEach(function(button) {
    const active = Number(button.dataset.level) === Number(level);
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const note = document.querySelector(".autonomy p");
  if (note) note.textContent = chosen.description + " Only selected Council advisers contribute.";
}
document.addEventListener("DOMContentLoaded", function() {
  setAssistanceLevel(window.jeevesModeLevel);
});

const SUPABASE_URL = "https://aelsipdtezvhjkwsshqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_JbN0kUdtX6d5J8bWAPbz4w_syw2aG4K";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let history = [];
let activeConversationId = null;
let conversationSwitchToken = 0;
let conversationBusy = false;
let sendingMessage = false;

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
  addMessageActions(div, text, who);
  scrollChat();
  return div;
}

function addMessageActions(messageElement, messageText, who) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.setAttribute("aria-label", "Message actions");

  const copy = makeButton("Copy", async function () {
    try {
      await navigator.clipboard.writeText(messageText);
      copy.textContent = "Copied";
      setTimeout(function () { copy.textContent = "Copy"; }, 1400);
    } catch (error) { addNote("Could not copy this message. Check browser clipboard permissions."); }
  });
  const share = makeButton("Share", async function () {
    try {
      if (navigator.share) await navigator.share({ title: "Jeeves message", text: messageText });
      else {
        await navigator.clipboard.writeText(messageText);
        share.textContent = "Copied to share";
        setTimeout(function () { share.textContent = "Share"; }, 1600);
      }
    } catch (error) {
      if (error.name !== "AbortError") addNote("Sharing is unavailable on this device.");
    }
  });
  const read = makeButton("Read aloud", function () {
    if (!("speechSynthesis" in window)) { addNote("Read aloud is not supported by this browser."); return; }
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(messageText);
    utterance.lang = document.documentElement.lang || "en-GB";
    window.speechSynthesis.speak(utterance);
  });
  const remove = makeButton("Delete", async function () {
    if (!window.confirm("Delete this message?")) return;
    const id = messageElement.dataset.messageId;
    if (id) {
      const { error } = await db.from("conversation_messages").delete().eq("id", id);
      if (error) { addNote("Could not delete message: " + error.message); return; }
    }
    const role = who === "bot" ? "model" : "user";
    const historyIndex = history.findIndex(function (item) { return item.role === role && item.text === messageText; });
    if (historyIndex >= 0) history.splice(historyIndex, 1);
    messageElement.remove();
    actions.remove();
  });
  actions.append(copy, share, read, remove);
  messageElement.insertAdjacentElement("afterend", actions);
  return actions;
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

function newChat() {
  if (sendingMessage) return;
  conversationSwitchToken++;
  conversationBusy = false;
  activeConversationId = null;
  history = [];
  document.getElementById("conversationSelect").value = "";
  renderChatLog();
  document.getElementById("chat").textContent = "";
}

function clearChat() {
  newChat();
}

async function enableTaskNotifications() {
  if (!("Notification" in window)) {
    addNote("This browser does not support notifications.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    addNote("Task notifications enabled on this device.");
    checkAlerts();
  } else {
    addNote(permission === "denied"
      ? "Notifications are blocked in browser settings."
      : "Notification permission was not granted.");
  }
}

async function sendTestNotification() {
  if (!("Notification" in window)) {
    addNote("This browser does not support notifications.");
    return;
  }
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    addNote(permission === "denied"
      ? "Notifications are blocked in browser settings. Allow them for this site, then try again."
      : "Notification permission was not granted.");
    return;
  }

  const title = "JEEVES notification test";
  const options = {
    body: "Success — device notifications are enabled. Tap this alert to reopen JEEVES.",
    tag: "jeeves-test-notification-" + Date.now(),
    data: { url: window.location.href }
  };
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    addNote("Test notification sent. Check your device notification shade.");
  } catch (error) {
    addNote("Could not show test notification: " + error.message);
  }
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

  // Notify once per task per local day when the user has explicitly enabled notifications.
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const today = new Date().toLocaleDateString("en-CA");
      const storageKey = "jeeves-notified-tasks-" + today;
      const notified = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
      const fresh = data.filter(function (task) { return !notified.has(task.id); });
      if (fresh.length) {
        const titles = fresh.slice(0, 3).map(function (task) { return task.title; });
        const extra = fresh.length > 3 ? " +" + (fresh.length - 3) + " more" : "";
        const title = fresh.length === 1 ? "JEEVES task reminder" : "JEEVES task reminders";
        const options = {
          body: titles.join("\n") + extra,
          tag: "jeeves-task-reminders",
          data: { url: window.location.href }
        };
        let shown = false;
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, options);
          shown = true;
        } else {
          new Notification(title, options);
          shown = true;
        }
        if (shown) {
          fresh.forEach(function (task) { notified.add(task.id); });
          localStorage.setItem(storageKey, JSON.stringify(Array.from(notified)));
        }
      }
    } catch (notificationError) {
      console.warn("Could not show task notification:", notificationError);
    }
  }

  // Speak each newly due-soon/overdue task once per local day while voice is enabled.
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const storageKey = "jeeves-spoken-alerts-" + today;
    const announced = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
    const fresh = data.filter(function (task) { return !announced.has(task.id); });
    if (fresh.length && typeof speak === "function" && typeof speakOn !== "undefined" && speakOn) {
      fresh.forEach(function (task) { announced.add(task.id); });
      localStorage.setItem(storageKey, JSON.stringify(Array.from(announced)));
      const first = fresh.slice(0, 3).map(function (task) {
        const due = new Date(task.due_at);
        return task.title + (due < now ? ", overdue" : ", due soon");
      });
      const extra = fresh.length > 3 ? " And " + (fresh.length - 3) + " more." : "";
      speak("A quick reminder. " + first.join(". ") + "." + extra + " You can review your tasks in JEEVES.");
    }
  } catch (announcementError) {
    console.warn("Could not store spoken task reminders:", announcementError);
  }
}

async function requireSession() {
  const { data } = await db.auth.getSession();
  if (!data.session) {
    addMessage("Please sign in first (tap the Account bar at the top).", "bot");
    return false;
  }
  return true;
}

function renderChatLog() {
  const list = document.getElementById("chat-log-list");
  const picker = document.getElementById("conversationSelect");
  const deleteButton = document.getElementById("chat-log-delete");
  if (!list || !picker) return;
  list.textContent = "";
  const options = Array.from(picker.options).filter(option => option.value && option.value !== "__new__");
  list.classList.toggle("has-history", options.length > 0);
  if (!options.length) {
    const empty = document.createElement("p");
    empty.className = "chat-log-empty";
    empty.textContent = picker.disabled ? "Sign in to load chats" : "No saved chats yet";
    list.appendChild(empty);
  }
  options.forEach(function(option) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-log-item" + (picker.value === option.value ? " active" : "");
    item.textContent = option.textContent || "Untitled chat";
    item.title = item.textContent;
    item.onclick = function() {
      picker.value = option.value;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    };
    list.appendChild(item);
  });
  if (deleteButton) deleteButton.disabled = !picker.value || picker.value === "__new__";
}

async function refreshConversationList(selectedId, openSelected) {
  const picker = document.getElementById("conversationSelect");
  const { data: sessionData } = await db.auth.getSession();
  if (!sessionData.session) {
    picker.innerHTML = '<option value="">Sign in to load conversations</option>';
    picker.disabled = true;
    renderChatLog();
    return;
  }
  const { data, error } = await db.from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    addNote("Could not load conversation history: " + error.message);
    return;
  }
  picker.innerHTML = "";
  const newOption = document.createElement("option");
  newOption.value = "__new__";
  newOption.textContent = "＋ New chat";
  picker.appendChild(newOption);
  (data || []).forEach(function(conversation) {
    const option = document.createElement("option");
    option.value = conversation.id;
    option.textContent = conversation.title || "Untitled chat";
    picker.appendChild(option);
  });
  picker.disabled = sendingMessage;
  picker.value = selectedId || "";
  renderChatLog();
  if (openSelected && selectedId) await openConversation(selectedId);
}

async function deleteConversation() {
  const picker = document.getElementById("conversationSelect");
  const id = picker.value;
  if (!id || id === "__new__" || sendingMessage || conversationBusy) return;
  const title = picker.options[picker.selectedIndex]?.textContent || "this conversation";
  if (!window.confirm('Permanently delete "' + title + '" and all its messages? This cannot be undone.')) return;
  const button = document.getElementById("deleteConversationBtn");
  button.disabled = true;
  try {
    const { data, error } = await db.from("conversations").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Conversation was not deleted. Check your access and try again.");
    if (activeConversationId === id) {
      conversationSwitchToken++;
      conversationBusy = false;
      activeConversationId = null;
      history = [];
      document.getElementById("chat").textContent = "";
    }
    await refreshConversationList(null, false);
    renderChatLog();
    addNote("Conversation deleted.");
  } catch (error) {
    addNote("Could not delete conversation: " + error.message);
  } finally {
    button.disabled = !picker.value || sendingMessage || conversationBusy;
  }
}

async function openConversation(id) {
  if (!id) return;
  const token = ++conversationSwitchToken;
  conversationBusy = true;
  const { data, error } = await db
    .from("conversation_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (token !== conversationSwitchToken) return;
  conversationBusy = false;

  if (error) {
    addNote("Could not open that conversation: " + error.message);
    return;
  }

  activeConversationId = id;
  history = (data || []).map(function (message) {
    return {
      role: message.role === "assistant" ? "model" : "user",
      text: message.content
    };
  });

  const chat = document.getElementById("chat");
  chat.textContent = "";
  (data || []).forEach(function (message) {
    const bubble = addMessage(message.content, message.role === "assistant" ? "bot" : "user");
    bubble.dataset.messageId = message.id;
    if (message.role === "assistant") addFeedbackControls(bubble, message.id, id);
  });
  if (!data || data.length === 0) addMessage("This conversation is empty. Send a message to continue.", "bot");
}

async function createConversation(firstMessage) {
  const title = firstMessage.trim().replace(/\s+/g, " ").slice(0, 60) || "New conversation";
  const { data, error } = await db
    .from("conversations")
    .insert({ title: title })
    .select("id")
    .single();

  if (error) throw error;
  activeConversationId = data.id;
  await refreshConversationList(activeConversationId, false);
  return activeConversationId;
}

async function saveConversationMessage(role, content) {
  const { data, error } = await db.from("conversation_messages").insert({
    conversation_id: activeConversationId,
    role: role,
    content: content
  }).select("id").single();
  if (error) throw error;

  const { error: updateError } = await db
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", activeConversationId);
  if (updateError) throw updateError;
  return data.id;
}

function addFeedbackControls(messageElement, messageId, conversationId) {
  if (!messageElement || !messageId) return;
  const controls = document.createElement("div");
  controls.className = "feedback-controls";

  const helpful = makeButton("👍 Helpful", function () {
    submitFeedback(controls, messageId, conversationId, "helpful", 1, null);
  });
  const unhelpful = makeButton("👎 Not helpful", function () {
    submitFeedback(controls, messageId, conversationId, "unhelpful", -1, null);
  });
  const correction = makeButton("✎ Correct", function () {
    const text = window.prompt("What should JEEVES have said instead?");
    if (text && text.trim()) {
      const remember = window.confirm("Save this correction as a lasting JEEVES response preference? Choose OK only if it should guide future conversations.");
      submitFeedback(controls, messageId, conversationId, "correction", null, text.trim(), remember);
    }
  });
  controls.append(helpful, unhelpful, correction);
  controls.setAttribute("aria-label", "Rate this JEEVES response");
  messageElement.insertAdjacentElement("afterend", controls);
}

async function submitFeedback(controls, messageId, conversationId, feedbackType, rating, correction, rememberAsPreference) {
  if (controls.dataset.submitted === "true" || controls.dataset.saving === "true") return;
  controls.dataset.saving = "true";
  const { error } = await db.from("assistant_feedback").insert({
    conversation_id: conversationId,
    assistant_message_id: messageId,
    feedback_type: feedbackType,
    rating: rating,
    correction: correction,
    remember_as_preference: rememberAsPreference === true
  });

  controls.dataset.saving = "false";
  if (error) {
    addNote("Could not save feedback: " + error.message);
    return;
  }

  controls.dataset.submitted = "true";
  controls.querySelectorAll("button").forEach(function (button) {
    button.disabled = true;
  });
  const confirmation = document.createElement("span");
  confirmation.textContent = rememberAsPreference === true ? "Feedback and lasting preference saved" : "Feedback saved";
  controls.appendChild(confirmation);
}

function startMorningBriefing(automatic) {
  const input = document.getElementById("command");
  if (!input || sendingMessage || conversationBusy) return false;
  const prompt = "Prepare my concise morning executive briefing. Use only information actually available in my saved tasks, memories and recent conversation context. Cover: (1) overdue and due-today tasks, (2) today's priorities, (3) active projects and one practical next action for each, and (4) any personal commitments I have explicitly recorded. Separate confirmed facts from suggestions. If schedule/calendar data is unavailable, say so; do not invent appointments, deadlines, progress or commitments. End with the single most valuable action to start now.";
  input.value = prompt;
  if (automatic) {
    addNote("☀️ Preparing your daily JEEVES briefing…");
  }
  send();
  return true;
}

function maybeRunMorningBriefing() {
  try {
    const hour = new Date().getHours();
    if (hour < 6 || hour >= 11) return;
    const key = "jeeves-morning-briefing-" + new Date().toLocaleDateString("en-CA");
    if (localStorage.getItem(key) === "done") return;
    if (startMorningBriefing(true)) localStorage.setItem(key, "done");
  } catch (error) {
    console.warn("Morning briefing could not start:", error);
  }
}

async function send() {
  const input = document.getElementById("command");
  const message = input.value.trim();

  if (!message || conversationBusy || sendingMessage) return;
  if (!(await requireSession())) return;

  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const userBubble = addMessage(message, "user");
  sendingMessage = true;
  document.getElementById("newchatbtn").disabled = true;
  document.getElementById("conversationSelect").disabled = true;
  const activeAdvisers = Array.from(document.querySelectorAll(".council-toggle:checked")).map(function (el) { return el.dataset.adviser; });
  const adviserNames = activeAdvisers.map(function (name) { return name.toUpperCase(); });
  const thinking = addMessage(activeAdvisers.length ? "Jeeves is consulting " + adviserNames.join(", ") + "…" : "Jeeves is preparing your response…", "bot");

  try {
    if (!activeConversationId) await createConversation(message);
    saveConversationMessage("user", message).then(id => { if (userBubble) userBubble.dataset.messageId = id; }).catch(error => console.warn("User message save failed:", error));
    history.push({ role: "user", text: message });
    const modelHistory = history.slice(-11, -1).slice(-10);

    const { data, error } = await db.functions.invoke("jarvis-brain", {
      body: {
        message: message,
        mode: window.jeevesModeLevel || 3,
        active_advisers: activeAdvisers,
        history: modelHistory,
        now: new Date().toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

    if (error) {
      let detail = error.message;
      try {
        const body = await error.context.json();
        if (body && body.error) detail = body.error;
      } catch (e) {}
      thinking.textContent = "AI error: " + detail + " (your message has been saved)";
      return;
    }

    if (!data || typeof data.reply !== "string") {
      thinking.textContent = "AI returned an unexpected response. Your message has been saved.";
      return;
    }

    thinking.textContent = data.reply;
    window.lastResponseSpeaker = data.speaker || (activeAdvisers.length === 1 ? activeAdvisers[0] : "jeeves");
    const savedConversationId = activeConversationId;
    saveConversationMessage("assistant", data.reply).then(id => { thinking.dataset.messageId = id; addFeedbackControls(thinking, id, savedConversationId); }).catch(error => console.warn("Assistant message save failed:", error));
    history.push({ role: "model", text: data.reply });
    history = history.slice(-10);
    refreshConversationList(activeConversationId, false).catch(error => console.warn("Conversation list refresh failed:", error));

    if (data.saved) addNote("💾 Saved to memory: " + data.saved);
    if (data.task) {
      addNote("✅ Task added: " + data.task + " (tap Show tasks to see it)");
      checkAlerts();
    }
    scrollChat();
  } catch (error) {
    thinking.textContent = "Could not save or send this message: " + error.message;
  } finally {
    sendingMessage = false;
    document.getElementById("newchatbtn").disabled = false;
    const { data: currentSession } = await db.auth.getSession();
    document.getElementById("conversationSelect").disabled = !currentSession.session;
    input.focus();
  }
}

document.getElementById("command").addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});

document.getElementById("conversationSelect").addEventListener("change", function (event) {
  const selected = event.target.value;
  const deleteButton = document.getElementById("deleteConversationBtn");
  if (selected === "__new__") {
    newChat();
    if (deleteButton) deleteButton.disabled = true;
    return;
  }
  if (deleteButton) deleteButton.disabled = !selected || sendingMessage || conversationBusy;
  renderChatLog();
  if (selected) openConversation(selected);
});

db.auth.onAuthStateChange(function (event, session) {
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
    if (session) {
      setTimeout(async function () {
        await refreshConversationList(null, false);
        db.functions.invoke("jarvis-brain", { body: { ping: true } }).catch(error => console.warn("Jeeves warm-up ping failed:", error));
        // Start every workspace visit with a blank chat.
        // Previous conversations remain available in the selector.
        document.getElementById("chat").textContent = "";
        history = [];
        activeConversationId = null;
      }, 0);
    }
  } else if (event === "SIGNED_OUT") {
    conversationSwitchToken++;
    conversationBusy = false;
    activeConversationId = null;
    history = [];
    document.getElementById("chat").textContent = "";
    document.getElementById("conversationSelect").innerHTML = '<option value="">Sign in to load conversations</option>';
    document.getElementById("conversationSelect").disabled = true;
    renderChatLog();
    addMessage("Signed out. Sign in to access your saved conversations.", "bot");
  }
});
