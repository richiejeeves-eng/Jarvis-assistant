function renameText(text) {
  return String(text)
    .replace(/JARVIS REMEMBERS/g, "JEEVES REMEMBERS")
    .replace(/JARVIS/g, "Jeeves")
    .replace(/Jarvis/g, "Jeeves");
}

const originalAddMessage = addMessage;
addMessage = function (text, who) {
  return originalAddMessage(renameText(text), who);
};

const firstMessage = document.querySelector("#chat .msg");
if (firstMessage) {
  firstMessage.textContent = renameText(firstMessage.textContent);
}

const THEMES = [
  { id: "navy", label: "Navy", color: "#080d18" },
  { id: "green", label: "Butler", color: "#0b1a14" },
  { id: "light", label: "Light", color: "#f4efe4" }
];

function applyTheme(id) {
  const theme = THEMES.find(function (t) { return t.id === id; }) || THEMES[0];

  if (theme.id === "navy") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme.id);
  }

  const button = document.getElementById("themebtn");
  if (button) { button.textContent = "◐"; button.setAttribute("aria-label", "Change theme · current: " + theme.label); button.title = "Theme: " + theme.label; }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.color);

  try {
    localStorage.setItem("jeeves-theme", theme.id);
  } catch (e) {}
}

function cycleTheme() {
  let current = "navy";
  try {
    current = localStorage.getItem("jeeves-theme") || "navy";
  } catch (e) {}

  const index = THEMES.findIndex(function (t) { return t.id === current; });
  applyTheme(THEMES[(index + 1) % THEMES.length].id);
}

let savedTheme = "navy";
try {
  savedTheme = localStorage.getItem("jeeves-theme") || "navy";
} catch (e) {}
applyTheme(savedTheme);

async function useMyLocation() {
  if (!navigator.geolocation) {
    addMessage("Location is not available in this browser.", "bot");
    return;
  }

  const { data: userData } = await db.auth.getUser();
  const user = userData && userData.user;
  if (!user) {
    addMessage("Please sign in first, then tap Location.", "bot");
    return;
  }

  const meta = user.user_metadata || {};
  if (meta.home_lat != null && !confirm("A location is already saved.\nOK = update it\nCancel = remove it")) {
    await db.auth.updateUser({ data: { home_lat: null, home_lon: null } });
    addMessage("Saved location removed.", "bot");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async function (position) {
      const lat = Math.round(position.coords.latitude * 100) / 100;
      const lon = Math.round(position.coords.longitude * 100) / 100;
      const { error } = await db.auth.updateUser({ data: { home_lat: lat, home_lon: lon } });
      if (error) {
        addMessage("Location error: " + error.message, "bot");
        return;
      }
      addMessage("Approximate location saved. Ask me about the weather any time.", "bot");
    },
    function (err) {
      addMessage("Location error: " + err.message, "bot");
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
  );
}

const locationButton = document.createElement("button");
locationButton.id = "locbtn";
locationButton.textContent = "📍";
locationButton.className = "tool-icon";
locationButton.setAttribute("aria-label", "Save or update location");
locationButton.setAttribute("data-description", "Save or update your location");
locationButton.onclick = useMyLocation;
const toolsBar = document.getElementById("tools");
if (toolsBar) toolsBar.appendChild(locationButton);

["photo.js?v=1.0"].forEach(function (src) {
  const script = document.createElement("script");
  script.src = src;
  document.body.appendChild(script);
});