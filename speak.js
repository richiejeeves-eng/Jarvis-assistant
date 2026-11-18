let speakOn = false;
let profileIndex = 0;
let voiceURI = "";

try {
  speakOn = localStorage.getItem("jeeves-speak") === "on";
  profileIndex = parseInt(localStorage.getItem("jeeves-profile") || "0", 10) || 0;
  voiceURI = localStorage.getItem("jeeves-voice") || "";
} catch (e) {}

const PROFILES = [
  { name: "Butler", rate: 0.9, pitch: 0.85 },
  { name: "Friendly", rate: 1.0, pitch: 1.15 },
  { name: "Brisk", rate: 1.3, pitch: 1.0 }
];

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
}

function getVoices() {
  if (!window.speechSynthesis) return [];
  const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
  return window.speechSynthesis.getVoices().filter(function (v) {
    return v.lang.toLowerCase().startsWith(lang);
  });
}

function updateSpeakButtons() {
  const speakButton = document.getElementById("speakbtn");
  if (speakButton) speakButton.textContent = speakOn ? "🔊 Voice on" : "🔇 Voice off";

  const styleButton = document.getElementById("stylebtn");
  if (styleButton) {
    styleButton.textContent = "🎭 Style: " + PROFILES[profileIndex % PROFILES.length].name;
  }

  const voiceButton = document.getElementById("voicebtn");
  if (voiceButton) {
    const voices = getVoices();
    const index = voices.findIndex(function (v) { return v.voiceURI === voiceURI; });
    voiceButton.textContent = "🗣 Voice " + (index + 1) + "/" + voices.length;
  }
}

function speakNow(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const profile = PROFILES[profileIndex % PROFILES.length];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en-GB";
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;

  const voice = getVoices().find(function (v) { return v.voiceURI === voiceURI; });
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

function speak(text) {
  if (!speakOn) return;
  speakNow(text);
}

function toggleSpeak() {
  speakOn = !speakOn;
  saveSetting("jeeves-speak", speakOn ? "on" : "off");
  if (!speakOn && window.speechSynthesis) window.speechSynthesis.cancel();
  updateSpeakButtons();
}

function cycleProfile() {
  profileIndex = (profileIndex + 1) % PROFILES.length;
  saveSetting("jeeves-profile", String(profileIndex));
  updateSpeakButtons();
  speakNow("Good day. At your service.");
}

function cycleVoice() {
  const voices = getVoices();
  if (voices.length === 0) {
    addMessage("No other voices were found on this device.", "bot");
    return;
  }

  const index = voices.findIndex(function (v) { return v.voiceURI === voiceURI; });
  const next = voices[(index + 1) % voices.length];
  voiceURI = next.voiceURI;
  saveSetting("jeeves-voice", voiceURI);
  updateSpeakButtons();
  speakNow("Good day. At your service.");
}

function makeToolButton(id, handler) {
  const button = document.createElement("button");
  button.id = id;
  button.onclick = handler;
  document.getElementById("tools").appendChild(button);
}

makeToolButton("stylebtn", cycleProfile);
makeToolButton("voicebtn", cycleVoice);

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = updateSpeakButtons;
}

const originalSend = send;
send = async function () {
  const before = document.querySelectorAll("#chat .msg").length;
  await originalSend();
  const messages = document.querySelectorAll("#chat .msg");
  const last = messages[messages.length - 1];
  if (
    messages.length > before + 1 &&
    last.classList.contains("bot") &&
    !last.textContent.startsWith("AI error")
  ) {
    speak(last.textContent);
  }
};

updateSpeakButtons();