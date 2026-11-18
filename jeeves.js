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
  if (button) button.textContent = "Theme: " + theme.label;

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