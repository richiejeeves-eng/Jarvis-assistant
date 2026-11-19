(function () {
  const entries = [
    { group: "CORE SERVICES", name: "Gemini AI", detail: "Jeeves reasoning via jarvis-brain", status: "Configured", kind: "ready", icon: "✧" },
    { group: "CORE SERVICES", name: "Supabase", detail: "Authentication, database and persistent conversations", status: "Configured", kind: "ready", icon: "▤" },
    { group: "CORE SERVICES", name: "ElevenLabs", detail: "Jeeves voice generation via jeeves-voice", status: "Configured", kind: "ready", icon: "♫" },
    { group: "GOOGLE WORKSPACE", name: "Google Calendar", detail: "Read upcoming events and create approved events", status: "OAuth setup required", kind: "setup", icon: "◷" },
    { group: "GOOGLE WORKSPACE", name: "Gmail", detail: "Search, summarise and draft email with permission", status: "OAuth setup required", kind: "setup", icon: "✉" },
    { group: "GOOGLE WORKSPACE", name: "Google Drive", detail: "Find and work with selected documents", status: "OAuth setup required", kind: "setup", icon: "▧" },
    { group: "HEALTH & FITNESS", name: "Health Connect", detail: "Android health and activity data", status: "Not wired into Jeeves", kind: "planned", icon: "⌁" },
    { group: "HEALTH & FITNESS", name: "MyFitnessPal", detail: "Nutrition and food diary data", status: "Not wired into Jeeves", kind: "planned", icon: "◉" }
  ];

  const prompts = {
    "Gmail": "Help me integrate Gmail into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
    "Google Drive": "Help me integrate Google Drive into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
    "Health Connect": "Plan a secure Android Health Connect integration for Jeeves. Inspect what is currently available and identify the required Android bridge and permissions. Do not claim it is connected until verified.",
    "MyFitnessPal": "Plan a secure MyFitnessPal integration for Jeeves. Check current supported API or export options first; do not assume an API is available and do not claim it is connected until verified."
  };

  function note(message) {
    if (typeof addNote === "function") addNote(message);
    else if (typeof addMessage === "function") addMessage(message, "bot");
  }

  function promptJeeves(message) {
    if (typeof quickPrompt === "function") quickPrompt(message);
    const command = document.getElementById("command");
    if (command) {
      command.scrollIntoView({ behavior: "smooth", block: "center" });
      command.focus();
    }
    if (innerWidth <= 800) document.getElementById("right-drawer")?.classList.remove("open");
  }

  async function calendarAction(action, extra) {
    if (!window.db || !db.functions) {
      note("Jeeves connection service is not ready. Refresh and try again.");
      return null;
    }
    const result = await db.functions.invoke("google-calendar", { body: Object.assign({ action }, extra || {}) });
    if (result.error) {
      let detail = result.error.message || "Request failed.";
      try {
        const body = await result.error.context.json();
        if (body?.error) detail = body.error;
      } catch (_) {}
      throw new Error(detail);
    }
    return result.data;
  }

  async function connectCalendar(button) {
    button.disabled = true;
    button.textContent = "Preparing secure connection…";
    try {
      const data = await calendarAction("authorize");
      if (!data?.url) throw new Error("Google authorisation URL was not returned.");
      window.location.assign(data.url);
    } catch (error) {
      note("Google Calendar setup: " + error.message);
      button.disabled = false;
      button.textContent = "Connect Google Calendar ↗";
    }
  }

  async function showCalendarEvents(button) {
    button.disabled = true;
    button.textContent = "Loading events…";
    try {
      const data = await calendarAction("events");
      const events = data.events || [];
      if (!events.length) {
        note("Google Calendar is connected. No upcoming events were returned.");
      } else {
        const lines = events.map(function (event) {
          const when = event.start ? new Date(event.start).toLocaleString() : "Time not supplied";
          return "• " + event.summary + " — " + when + (event.location ? " — " + event.location : "");
        });
        note("Upcoming Google Calendar events:\n" + lines.join("\n"));
      }
    } catch (error) {
      note("Calendar events could not be loaded: " + error.message);
    } finally {
      button.disabled = false;
      button.textContent = "View upcoming events";
    }
  }

  async function disconnectCalendar(button) {
    if (!window.confirm("Disconnect Google Calendar from Jeeves?")) return;
    button.disabled = true;
    try {
      await calendarAction("disconnect");
      note("Google Calendar disconnected. Its stored tokens have been removed.");
      render();
    } catch (error) {
      note("Could not disconnect Google Calendar: " + error.message);
      button.disabled = false;
    }
  }

  function render() {
    const root = document.getElementById("integrations-manager");
    if (!root) return;
    let currentGroup = "";
    let html = '<div class="integration-intro"><span class="eyebrow">EXTEND YOUR PRIVATE OFFICE</span><h3>Integration directory</h3><p>Services are only marked connected after a verified account connection. External accounts need their own secure authorisation.</p></div>';
    entries.forEach(function (item) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        html += '<div class="integration-group-label">' + currentGroup + '</div>';
      }
      html += '<article class="integration-tile" data-tile="' + item.name + '"><div class="integration-tile-top"><span class="integration-icon">' + item.icon + '</span><span class="integration-status ' + item.kind + '" data-status>' + item.status + '</span></div><h4>' + item.name + '</h4><p>' + item.detail + '</p>';
      if (item.name === "Google Calendar") {
        html += '<button class="integration-action" type="button" data-calendar-connect>Connect Google Calendar ↗</button><div class="calendar-connected-actions" hidden><button class="integration-action" type="button" data-calendar-events>View upcoming events</button><button class="integration-action secondary" type="button" data-calendar-disconnect>Disconnect</button></div>';
      } else if (item.kind === "setup" || item.kind === "planned") {
        html += '<button class="integration-action" type="button" data-integration="' + item.name + '">Prepare connection ↗</button>';
      } else {
        html += '<span class="integration-configured">✓ Backend configured</span>';
      }
      html += '</article>';
    });
    html += '<p class="integration-security">Security rule: OAuth tokens are encrypted server-side. API secrets belong in Supabase secrets — never in browser JavaScript.</p>';
    root.innerHTML = html;

    root.querySelectorAll("[data-integration]").forEach(function (button) {
      button.addEventListener("click", function () {
        promptJeeves(prompts[button.dataset.integration] || ("Help me configure " + button.dataset.integration + " securely."));
      });
    });
    root.querySelector("[data-calendar-connect]")?.addEventListener("click", function (event) {
      connectCalendar(event.currentTarget);
    });
    root.querySelector("[data-calendar-events]")?.addEventListener("click", function (event) {
      showCalendarEvents(event.currentTarget);
    });
    root.querySelector("[data-calendar-disconnect]")?.addEventListener("click", function (event) {
      disconnectCalendar(event.currentTarget);
    });

    if (window.db && db.auth) {
      calendarAction("status").then(function (status) {
        const tile = root.querySelector('[data-tile="Google Calendar"]');
        if (!tile || !status) return;
        const badge = tile.querySelector("[data-status]");
        const connect = tile.querySelector("[data-calendar-connect]");
        const actions = tile.querySelector(".calendar-connected-actions");
        if (status.connected) {
          badge.textContent = "Connected";
          badge.className = "integration-status ready";
          connect.hidden = true;
          actions.hidden = false;
        } else {
          badge.textContent = "Not connected";
          badge.className = "integration-status setup";
          connect.hidden = false;
          actions.hidden = true;
        }
      }).catch(function (error) {
        const tile = root.querySelector('[data-tile="Google Calendar"]');
        if (tile) tile.querySelector("[data-status]").textContent = error.message.includes("sign in") ? "Sign in required" : "Setup required";
      });
    }
  }

  window.renderJeevesIntegrations = render;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  const callback = new URLSearchParams(window.location.search).get("calendar");
  if (callback) {
    window.addEventListener("load", function () {
      if (callback === "connected") note("Google Calendar successfully connected to Jeeves.");
      else note("Google Calendar connection was not completed: " + (new URLSearchParams(window.location.search).get("reason") || callback) + ".");
      const clean = new URL(window.location.href);
      clean.searchParams.delete("calendar");
      clean.searchParams.delete("reason");
      window.history.replaceState({}, "", clean.toString());
      render();
    });
  }
})();