(function () {
  const entries = [
    { group: "CORE SERVICES", name: "Gemini AI", detail: "Jeeves reasoning via jarvis-brain", status: "Configured", kind: "ready", icon: "✧" },
    { group: "CORE SERVICES", name: "Supabase", detail: "Authentication, database and persistent conversations", status: "Configured", kind: "ready", icon: "▤" },
    { group: "CORE SERVICES", name: "ElevenLabs", detail: "Jeeves voice generation via jeeves-voice", status: "Configured", kind: "ready", icon: "♫" },
    { group: "GOOGLE WORKSPACE", name: "Google Calendar", detail: "Read upcoming events and create approved events", status: "OAuth setup required", kind: "setup", icon: "◷" },
    { group: "GOOGLE WORKSPACE", name: "Google Tasks", detail: "Import Google Tasks into Jeeves and sync completion", status: "Additional permission required", kind: "setup", icon: "✓" },
    { group: "GOOGLE WORKSPACE", name: "Gmail", detail: "Read recent email metadata and snippets (read-only)", status: "Awaiting authorisation", kind: "setup", icon: "✉" },
    { group: "GOOGLE WORKSPACE", name: "Google Drive", detail: "List files and metadata (read-only)", status: "Awaiting authorisation", kind: "setup", icon: "▧" },
    { group: "HEALTH & FITNESS", name: "Health Connect", detail: "Sync source for Jeeves Fitness · steps, heart rate, sleep, weight, body fat and blood pressure", status: "Managed in Jeeves Fitness", kind: "ready", icon: "⌁" },
  ];

  const prompts = {
    "Gmail": "Help me integrate Gmail into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
    "Google Drive": "Help me integrate Google Drive into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
    "Health Connect": "Jeeves Health Android companion has been added to the repository. Help me build, install and verify the APK and Health Connect permissions. Do not claim it is connected until a live sync succeeds."
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
      // The sidebar tracks only the three services Rich explicitly selected:
      // Gemini AI, Google Calendar and Google Tasks. Gmail and Drive remain optional.
      const count = 1 + (status?.connected ? 1 : 0) + (status?.tasks_enabled ? 1 : 0);
      summary.textContent = count + " / 3 ACTIVE";
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
      if (item.name === "Health Connect") {
        html += '<button class="integration-action" type="button" data-health-build>Open Jeeves Fitness ↗</button>';
      } else if (item.name === "Google Tasks") {
        html += '<button class="integration-action" type="button" data-google-tasks-connect>Connect & grant Google Tasks access ↗</button><button class="integration-action" type="button" data-google-tasks-sync hidden>Sync Google Tasks ↻</button>';
      } else if (item.name === "Gmail") {
        html += '<button class="integration-action" type="button" data-gmail-action>Connect Gmail & grant access ↗</button>';
      } else if (item.name === "Google Drive") {
        html += '<button class="integration-action" type="button" data-google-extend="Google Drive">Connect with Google ↗</button>';
      } else if (item.name === "Google Calendar") {
        html += '<button class="integration-action" type="button" data-calendar-connect>Connect Google Calendar ↗</button><div class="calendar-connected-actions" hidden><button class="integration-action" type="button" data-calendar-events>Refresh upcoming events</button><button class="integration-action secondary" type="button" data-calendar-disconnect>Disconnect</button><div class="calendar-event-list" data-calendar-event-list><p class="calendar-empty">Your upcoming events will appear here.</p></div></div>';
      } else if (item.kind === "setup" || item.kind === "planned") {
        html += '<button class="integration-action" type="button" data-integration="' + item.name + '">Prepare connection ↗</button>';
      } else {
        html += '<span class="integration-configured">✓ Backend configured</span>';
      }
      html += '<details class="integration-more"><summary>Additional information</summary><div class="integration-more-content">';
      if (item.name === "Gmail") {
        html += '<p>Recent emails · read-only. Expand each message to see sender, date and preview.</p><div class="gmail-recent-list" data-gmail-recent-list><p class="calendar-empty">Use Load recent emails above to retrieve your messages.</p></div>';
      } else if (item.name === "Google Drive") {
        html += '<p>Browse recent Drive files and view file names, types, modified dates and links. Jeeves access remains read-only.</p><button class="integration-action" type="button" data-google-test="Google Drive" hidden>Check Drive connection ↻</button><div class="integration-test-result" data-test-result></div>';
      } else if (item.name === "Google Calendar") {
        html += '<p>View upcoming events, dates, times and locations. Use Refresh upcoming events to retrieve the latest schedule.</p>';
      } else if (item.name === "Google Tasks") {
        html += '<p>Import task lists, review task titles and due dates, and sync completion status with Jeeves.</p>';
      } else if (item.name === "Health Connect") {
        html += '<p>Health Connect supplies activity, heart-rate, sleep, weight and body-composition data to Jeeves Fitness on this device.</p>';
      } else {
        html += '<p>Jeeves reasoning service used by the private assistant workspace.</p>';
      }
      html += '</div></details></article>';
    });
    html += '<p class="integration-security">Security rule: OAuth tokens are encrypted server-side. API secrets belong in Supabase secrets — never in browser JavaScript.</p>';
    root.innerHTML = html;

    const style = document.createElement("style");
    style.textContent = ".calendar-event-list,.gmail-recent-list{margin-top:12px;border-top:1px solid #ffffff16;padding-top:5px}.calendar-event-row,.gmail-recent-row{display:grid;gap:5px;padding:10px 2px;border-bottom:1px solid #ffffff10}.gmail-recent-row{color:inherit;text-decoration:none;cursor:pointer}.gmail-recent-row:hover strong{text-decoration:underline;color:#dfbe7d}.calendar-event-row strong,.gmail-recent-row strong{font:600 12px Georgia,serif;color:#f4f4f6}.calendar-event-row span,.gmail-recent-row span{font-size:10px;color:#dfbe7d}.calendar-event-row small,.calendar-empty,.gmail-recent-row p{font-size:11px;color:#9ca3af;line-height:1.5}.calendar-empty{margin:8px 0}.integration-more{margin-top:14px;border-top:1px solid #ffffff16;padding-top:10px}.integration-more summary{color:#d8bd8a;font-size:12px;cursor:pointer;list-style:none}.integration-more summary::-webkit-details-marker{display:none}.integration-more summary:after{content:'＋';float:right;color:#d8bd8a}.integration-more[open] summary:after{content:'−'}.integration-more-content{padding-top:10px}.integration-more-content>p{font-size:12px;line-height:1.55;color:#aeb2bb;margin:4px 0 12px}";
    if (!document.getElementById("calendar-event-styles")) {
      style.id = "calendar-event-styles";
      document.head.appendChild(style);
    }

    root.querySelector("[data-health-build]")?.addEventListener("click", function () {
      if (typeof switchTab === "function") switchTab("fitness");
      if (innerWidth <= 800) document.getElementById("right-drawer")?.classList.remove("open");
    });
    root.querySelectorAll("[data-google-extend]").forEach(function (button) {
      button.addEventListener("click", function (event) { connectCalendar(event.currentTarget, button.dataset.googleExtend); });
    });
    root.querySelectorAll('[data-google-test="Google Drive"]').forEach(function (button) {
      button.addEventListener("click", async function (event) {
        const target = event.currentTarget;
        target.disabled = true;
        target.textContent = "Checking Drive…";
        try {
          const data = await calendarAction("driveFiles");
          const result = target.parentElement.querySelector("[data-test-result]");
          result.textContent = "Verified: " + (data.files || []).length + " recent Drive files returned.";
          note("Google Drive connection verified successfully.");
        } catch (error) { note("Google Drive test failed: " + error.message); }
        finally { target.disabled = false; target.textContent = "Check Drive connection ↻"; }
      });
    });
    const gmailRecentButton = root.querySelector("[data-gmail-action]");
    if (gmailRecentButton) {
      gmailRecentButton.addEventListener("click", async function () {
        const target = gmailRecentButton;
        if (target.dataset.connected !== "true") { connectCalendar(target, "Gmail"); return; }
        const list = root.querySelector("[data-gmail-recent-list]");
        target.disabled = true;
        target.textContent = "Loading recent emails…";
        try {
          const data = await calendarAction("gmailMessages");
          const messages = data.messages || [];
          list.replaceChildren();
          if (!messages.length) {
            const empty = document.createElement("p");
            empty.className = "calendar-empty";
            empty.textContent = "No recent emails were returned.";
            list.appendChild(empty);
          } else {
            messages.slice(0, 10).forEach(function (message) {
              const row = document.createElement("a");
              row.className = "gmail-recent-row";
              row.target = "_blank";
              row.rel = "noopener noreferrer";
              row.href = message.id
                ? "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(message.id)
                : (message.url || message.webLink || "https://mail.google.com/mail/u/0/#all");
              const subject = document.createElement("strong");
              subject.textContent = message.subject || "(No subject)";
              const meta = document.createElement("span");
              meta.textContent = [message.from || message.sender || "Unknown sender", message.date || ""].filter(Boolean).join(" · ");
              const preview = document.createElement("p");
              preview.textContent = message.snippet || message.preview || "No preview available.";
              row.append(subject, meta, preview);
              list.appendChild(row);
            });
          }
          note("Gmail returned " + messages.length + " recent messages.");
        } catch (error) {
          const message = document.createElement("p");
          message.className = "calendar-empty";
          message.textContent = "Recent emails could not be loaded: " + error.message;
          list.replaceChildren(message);
          note("Gmail recent emails could not be loaded: " + error.message);
        } finally {
          target.disabled = false;
          target.textContent = "Refresh recent emails ↻";
        }
      });
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
          const gmailTile = root.querySelector('[data-tile="Gmail"]');
        const driveTile = root.querySelector('[data-tile="Google Drive"]');
        [[gmailTile, status.gmail_enabled], [driveTile, status.drive_enabled]].forEach(function ([tile, enabled]) {
          if (!tile) return;
          const badge = tile.querySelector("[data-status]");
          const connect = tile.querySelector("[data-google-extend]");
          const test = tile.querySelector("[data-google-test]");
          const recent = tile.querySelector("[data-gmail-action]");
          badge.textContent = enabled ? "Connected" : (status.connected ? "Permission needed" : "Not connected");
          badge.className = "integration-status " + (enabled ? "ready" : "setup");
          connect.hidden = !!enabled;
          if (test) test.hidden = !enabled;
          if (recent) { recent.hidden = false; recent.dataset.connected = enabled ? "true" : "false"; recent.textContent = enabled ? "Load recent emails ↻" : "Connect Gmail & grant access ↗"; }
        });
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