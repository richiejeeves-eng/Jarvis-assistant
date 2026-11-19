(function () {
  const entries = [
    { group: "CORE SERVICES", name: "Gemini AI", detail: "Jeeves reasoning via jarvis-brain", status: "Configured", kind: "ready", icon: "✧" },
    { group: "CORE SERVICES", name: "Supabase", detail: "Authentication, database and persistent conversations", status: "Configured", kind: "ready", icon: "▤" },
    { group: "CORE SERVICES", name: "ElevenLabs", detail: "Jeeves voice generation via jeeves-voice", status: "Configured", kind: "ready", icon: "♫" },
    { group: "GOOGLE WORKSPACE", name: "Google Calendar", detail: "Read availability and manage approved events", status: "OAuth setup required", kind: "setup", icon: "◷" },
    { group: "GOOGLE WORKSPACE", name: "Gmail", detail: "Search, summarise and draft email with permission", status: "OAuth setup required", kind: "setup", icon: "✉" },
    { group: "GOOGLE WORKSPACE", name: "Google Drive", detail: "Find and work with selected documents", status: "OAuth setup required", kind: "setup", icon: "▧" },
    { group: "HEALTH & FITNESS", name: "Health Connect", detail: "Android health and activity data", status: "Not wired into Jeeves", kind: "planned", icon: "⌁" },
    { group: "HEALTH & FITNESS", name: "MyFitnessPal", detail: "Nutrition and food diary data", status: "Not wired into Jeeves", kind: "planned", icon: "◉" }
  ];

  function requestSetup(name) {
    const prompts = {
      "Google Calendar": "Help me integrate Google Calendar into Jeeves securely. First inspect the existing Supabase architecture and give me the exact OAuth setup steps. Do not claim it is connected until a live test succeeds.",
      "Gmail": "Help me integrate Gmail into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
      "Google Drive": "Help me integrate Google Drive into Jeeves securely using least-privilege OAuth scopes. First inspect the existing Supabase architecture and give me the exact setup steps. Do not claim it is connected until a live test succeeds.",
      "Health Connect": "Plan a secure Android Health Connect integration for Jeeves. Inspect what is currently available and identify the required Android bridge and permissions. Do not claim it is connected until verified.",
      "MyFitnessPal": "Plan a secure MyFitnessPal integration for Jeeves. Check current supported API or export options first; do not assume an API is available and do not claim it is connected until verified."
    };
    if (typeof quickPrompt === "function") quickPrompt(prompts[name] || ("Help me configure " + name + " in Jeeves securely."));
    const command = document.getElementById("command");
    if (command) {
      command.scrollIntoView({ behavior: "smooth", block: "center" });
      command.focus();
    }
    if (innerWidth <= 800) {
      const drawer = document.getElementById("right-drawer");
      if (drawer) drawer.classList.remove("open");
    }
  }

  function render() {
    const root = document.getElementById("integrations-manager");
    if (!root) return;
    let currentGroup = "";
    let html = '<div class="integration-intro"><span class="eyebrow">EXTEND YOUR PRIVATE OFFICE</span><h3>Integration directory</h3><p>Services are only marked configured when Jeeves has a corresponding backend or device connection. External accounts need their own secure authorisation.</p></div>';
    entries.forEach(function (item) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        html += '<div class="integration-group-label">' + currentGroup + '</div>';
      }
      html += '<article class="integration-tile"><div class="integration-tile-top"><span class="integration-icon">' + item.icon + '</span><span class="integration-status ' + item.kind + '">' + item.status + '</span></div><h4>' + item.name + '</h4><p>' + item.detail + '</p>';
      if (item.kind === "setup" || item.kind === "planned") {
        html += '<button class="integration-action" type="button" data-integration="' + item.name + '">Prepare connection ↗</button>';
      } else {
        html += '<span class="integration-configured">✓ Backend configured</span>';
      }
      html += '</article>';
    });
    html += '<p class="integration-security">Security rule: OAuth tokens and API secrets belong in Supabase secrets or a protected server-side vault — never in browser JavaScript.</p>';
    root.innerHTML = html;
    root.querySelectorAll("[data-integration]").forEach(function (button) {
      button.addEventListener("click", function () { requestSetup(button.dataset.integration); });
    });
  }

  window.renderJeevesIntegrations = render;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();