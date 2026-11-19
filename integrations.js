(function () {
  const entries = [
    { group: "CORE SERVICES", name: "Gemini AI", detail: "Jeeves reasoning via jarvis-brain", status: "Configured", kind: "ready", icon: "✧" },
    { group: "CORE SERVICES", name: "Supabase", detail: "Authentication, database and persistent conversations", status: "Configured", kind: "ready", icon: "▤" },
    { group: "CORE SERVICES", name: "ElevenLabs", detail: "Jeeves voice generation via jeeves-voice", status: "Configured", kind: "ready", icon: "♫" },
    { group: "GOOGLE WORKSPACE", name: "Google Calendar", detail: "Read upcoming events and create approved events", status: "OAuth setup required", kind: "setup", icon: "◷" },
    { group: "GOOGLE WORKSPACE", name: "Google Tasks", detail: "Import Google Tasks into Jeeves and sync completion", status: "Additional permission required", kind: "setup", icon: "✓" },
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
    if (typeof db === "undefined" || !db.functions) {
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

  function ukDateKey(value) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  function isTodayEvent(event) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) return false;
    // Google all-day events use an exclusive end date.
    const today = ukDateKey(new Date());
    const startDay = event.start.date ? event.start.date : ukDateKey(start);
    const endDay = event.end?.date || (event.end?.dateTime ? ukDateKey(event.end.dateTime) : startDay);
    return startDay <= today && today < endDay || startDay === today;
  }

  function formatEvent(event) {
    const start = event.start?.dateTime || event.start?.date || event.start;
    const when = start ? (event.start?.date
      ? "All day"
      : new Date(start).toLocaleTimeString("en-GB", {
          timeZone: "Europe/London", hour: "2-digit", minute: "2-digit"
        })) : "Time not supplied";
    return { title: event.summary || "Untitled event", when, location: event.location || "" };
  }

  function renderCalendarEvents(events) {
    const list = document.querySelector("[data-calendar-event-list]");
    if (!list) return;
    list.replaceChildren();
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "calendar-empty";
      empty.textContent = "No upcoming events found.";
      list.appendChild(empty);
      return;
    }
    events.forEach(function (event) {
      const item = formatEvent(event);
      const row = document.createElement("article");
      row.className = "calendar-event-row";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const time = document.createElement("span");
      time.textContent = item.when;
      row.append(title, time);
      if (item.location) {
        const place = document.createElement("small");
        place.textContent = item.location;
        row.appendChild(place);
      }
      list.appendChild(row);
    });
  }

  async function connectCalendar(button, service) {
    const label = service || "Google Calendar";
    button.disabled = true;
    button.textContent = "Preparing secure connection…";
    try {
      const data = await calendarAction("authorize");
      if (!data?.url) throw new Error("Google authorisation URL was not returned.");
      window.location.assign(data.url);
    } catch (error) {
      note(label + " setup: " + error.message);
      button.disabled = false;
      button.textContent = label === "Google Tasks"
        ? "Connect & grant Google Tasks access ↗"
        : "Connect Google Calendar ↗";
    }
  }

  async function syncGoogleTasks(button) {
    button.disabled = true;
    button.textContent = "Syncing Google Tasks…";
    try {
      const data = await calendarAction("syncTasks");
      note("Google Tasks sync complete. " + Number(data.imported || 0) + " tasks imported or updated.");
    } catch (error) {
      note("Google Tasks sync failed: " + error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Sync Google Tasks ↻";
    }
  }

  async function showCalendarEvents(button) {
    button.disabled = true;
    button.textContent = "Loading events…";
    try {
      const data = await calendarAction("events");
      const events = (data.events || []).filter(isTodayEvent);
      renderCalendarEvents(events);
      if (!events.length) {
        note("Google Calendar is connected. No events scheduled for today.");
      } else {
        const lines = events.map(function (event) {
          const item = formatEvent(event);
          return "• " + item.title + " — " + item.when + (item.location ? " — " + item.location : "");
        });
        note("Today's Google Calendar events:\n" + lines.join("\n"));
      }
    } catch (error) {
      note("Calendar events could not be loaded: " + error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Refresh upcoming events";
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

  function updateEcosystem(status) {
    const set = function (name, label, connected) {
      const item = document.querySelector('[data-eco="' + name + '"]');
      if (!item) return;
      const state = item.querySelector("i");
      if (state) state.textContent = label;
      item.classList.toggle("eco-connected", !!connected);
      item.classList.toggle("eco-pending", !connected);
    };
    set("Google Calendar", status?.connected ? "Connected" : "Not connected", !!status?.connected);
    set("Google Tasks", status?.tasks_enabled ? "Connected" : (status?.connected ? "Permission needed" : "Not connected"), !!status?.tasks_enabled);
    const summary = document.getElementById("eco-summary");
    if (summary) {
      const count = 3 + (status?.connected ? 1 : 0) + (status?.tasks_enabled ? 1 : 0);
      summary.textContent = count + " / 5 ACTIVE";
    }
    const updated = document.getElementById("eco-updated");
    if (updated) updated.textContent = status ? "Live connection status · just checked." : "Sign in to verify Google connections.";
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
      if (item.name === "Google Tasks") {
        html += '<button class="integration-action" type="button" data-google-tasks-connect>Connect & grant Google Tasks access ↗</button><button class="integration-action" type="button" data-google-tasks-sync hidden>Sync Google Tasks ↻</button>';
      } else if (item.name === "Google Calendar") {
        html += '<button class="integration-action" type="button" data-calendar-connect>Connect Google Calendar ↗</button><div class="calendar-connected-actions" hidden><button class="integration-action" type="button" data-calendar-events>Refresh upcoming events</button><button class="integration-action secondary" type="button" data-calendar-disconnect>Disconnect</button><div class="calendar-event-list" data-calendar-event-list><p class="calendar-empty">Your upcoming events will appear here.</p></div></div>';
      } else if (item.kind === "setup" || item.kind === "planned") {
        html += '<button class="integration-action" type="button" data-integration="' + item.name + '">Prepare connection ↗</button>';
      } else {
        html += '<span class="integration-configured">✓ Backend configured</span>';
      }
      html += '</article>';
    });
    html += '<p class="integration-security">Security rule: OAuth tokens are encrypted server-side. API secrets belong in Supabase secrets — never in browser JavaScript.</p>';
    root.innerHTML = html;

    const style = document.createElement("style");
    style.textContent = ".calendar-event-list{margin-top:12px;border-top:1px solid #ffffff16;padding-top:5px}.calendar-event-row{display:grid;gap:4px;padding:10px 2px;border-bottom:1px solid #ffffff10}.calendar-event-row strong{font:600 12px Georgia,serif;color:#f4f4f6}.calendar-event-row span{font-size:10px;color:#dfbe7d}.calendar-event-row small,.calendar-empty{font-size:9px;color:#9ca3af}.calendar-empty{margin:8px 0;line-height:1.5}";
    if (!document.getElementById("calendar-event-styles")) {
      style.id = "calendar-event-styles";
      document.head.appendChild(style);
    }

    root.querySelectorAll("[data-integration]").forEach(function (button) {
      button.addEventListener("click", function () {
        promptJeeves(prompts[button.dataset.integration] || ("Help me configure " + button.dataset.integration + " securely."));
      });
    });
    root.querySelector("[data-calendar-connect]")?.addEventListener("click", function (event) {
      connectCalendar(event.currentTarget, "Google Calendar");
    });
    root.querySelector("[data-google-tasks-connect]")?.addEventListener("click", function (event) {
      connectCalendar(event.currentTarget, "Google Tasks");
    });
    root.querySelector("[data-google-tasks-sync]")?.addEventListener("click", function (event) {
      syncGoogleTasks(event.currentTarget);
    });
    root.querySelector("[data-calendar-events]")?.addEventListener("click", function (event) {
      showCalendarEvents(event.currentTarget);
    });
    root.querySelector("[data-calendar-disconnect]")?.addEventListener("click", function (event) {
      disconnectCalendar(event.currentTarget);
    });

    if (typeof db !== "undefined" && db.auth) {
      calendarAction("status").then(function (status) {
        updateEcosystem(status);
        const tile = root.querySelector('[data-tile="Google Calendar"]');
        if (!tile || !status) return;
        const badge = tile.querySelector("[data-status]");
        const connect = tile.querySelector("[data-calendar-connect]");
        const actions = tile.querySelector(".calendar-connected-actions");
        const tasksTile = root.querySelector('[data-tile="Google Tasks"]');
        if (tasksTile) {
          const tasksBadge = tasksTile.querySelector("[data-status]");
          const tasksConnect = tasksTile.querySelector("[data-google-tasks-connect]");
          const tasksSync = tasksTile.querySelector("[data-google-tasks-sync]");
          if (status.tasks_enabled) {
            tasksBadge.textContent = "Connected";
            tasksBadge.className = "integration-status ready";
            tasksConnect.hidden = true;
            tasksSync.hidden = false;
          } else {
            tasksBadge.textContent = status.connected ? "Permission needed" : "Connect Google first";
            tasksBadge.className = "integration-status setup";
            tasksConnect.hidden = false;
            tasksSync.hidden = true;
          }
        }
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
        updateEcosystem(null);
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
      if (callback === "connected") note("Google Workspace connected. Calendar and Google Tasks permissions have been refreshed.");
      else note("Google Calendar connection was not completed: " + (new URLSearchParams(window.location.search).get("reason") || callback) + ".");
      const clean = new URL(window.location.href);
      clean.searchParams.delete("calendar");
      clean.searchParams.delete("reason");
      window.history.replaceState({}, "", clean.toString());
      render();
    });
  }
})();