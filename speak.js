let speakOn = false;
let profileIndex = 0;
let voiceURI = "";
let currentAudio = null;
let currentAudioUrl = null;
let useElevenLabs = true;
const JEEVES_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — British male voice

try {
  speakOn = localStorage.getItem("jeeves-speak") === "on";
  profileIndex = parseInt(localStorage.getItem("jeeves-profile") || "0", 10) || 0;
  voiceURI = localStorage.getItem("jeeves-voice") || "";
  useElevenLabs = localStorage.getItem("jeeves-elevenlabs") !== "off";
} catch (e) {}

const PROFILES = [
  { name: "Butler", rate: 0.9, pitch: 0.85 },
  { name: "Friendly", rate: 1.0, pitch: 1.15 },
  { name: "Brisk", rate: 1.3, pitch: 1.0 }
];

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function getVoices() {
  if (!window.speechSynthesis) return [];
  const lang = (navigator.language || "en-GB").slice(0, 2).toLowerCase();
  return window.speechSynthesis.getVoices().filter(function (v) {
    return v.lang.toLowerCase().startsWith(lang);
  });
}

function updateSpeakButtons() {
  const speakButton = document.getElementById("speakbtn");
  if (speakButton) { speakButton.textContent = speakOn ? "Voice on" : "Voice off"; speakButton.setAttribute("aria-label", speakOn ? "Turn voice off" : "Turn voice on"); speakButton.title = speakOn ? "Voice on" : "Voice off"; speakButton.setAttribute("aria-pressed", String(speakOn)); }
  const styleButton = document.getElementById("stylebtn");
  if (styleButton) { styleButton.textContent = "Voice style"; styleButton.setAttribute("aria-label", "Change voice style · current: " + PROFILES[profileIndex % PROFILES.length].name); styleButton.title = "Voice style: " + PROFILES[profileIndex % PROFILES.length].name; }
  const voiceButton = document.getElementById("voicebtn");
  if (voiceButton) {
    const voices = getVoices();
    const index = voices.findIndex(function (v) { return v.voiceURI === voiceURI; });
    voiceButton.textContent = "Voice source"; voiceButton.setAttribute("aria-label", useElevenLabs ? "Voice provider: Jeeves ElevenLabs" : "Device voice " + (index + 1) + " of " + voices.length); voiceButton.title = useElevenLabs ? "Jeeves · ElevenLabs" : "Device voice " + (index + 1) + "/" + voices.length;
  }
}

function speakWithBrowser(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const profile = PROFILES[profileIndex % PROFILES.length];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  const voice = getVoices().find(function (v) { return v.voiceURI === voiceURI; });
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

async function speakWithElevenLabs(text) {
  const { data, error } = await db.auth.getSession();
  const session = data && data.session;
  if (error || !session) throw new Error("Sign in required");
  const response = await fetch(SUPABASE_URL + "/functions/v1/jeeves-voice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": SUPABASE_KEY
    },
    body: JSON.stringify({ text: text.slice(0, 1200), voice_id: JEEVES_VOICE_ID })
  });
  if (!response.ok) {
    let detail = "Voice request failed";
    try { const body = await response.json(); detail = body.error || detail; } catch (e) {}
    throw new Error(detail);
  }
  const blob = await response.blob();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentAudioUrl);
  await currentAudio.play();
}

async function speakNow(text) {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (useElevenLabs) {
    try {
      await speakWithElevenLabs(text);
      return;
    } catch (error) {
      console.warn("JEEVES premium voice unavailable; using device voice:", error.message);
    }
  }
  speakWithBrowser(text);
}

function speak(text) {
  if (!speakOn || !text) return;
  speakNow(text);
}

function toggleSpeak() {
  speakOn = !speakOn;
  saveSetting("jeeves-speak", speakOn ? "on" : "off");
  if (!speakOn) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) currentAudio.pause();
  }
  updateSpeakButtons();
}

function cycleProfile() {
  profileIndex = (profileIndex + 1) % PROFILES.length;
  saveSetting("jeeves-profile", String(profileIndex));
  updateSpeakButtons();
  speakNow("Good day. At your service.");
}

function cycleVoice() {
  useElevenLabs = !useElevenLabs;
  saveSetting("jeeves-elevenlabs", useElevenLabs ? "on" : "off");
  if (!useElevenLabs) {
    const voices = getVoices();
    if (voices.length) {
      const index = voices.findIndex(function (v) { return v.voiceURI === voiceURI; });
      voiceURI = voices[(index + 1) % voices.length].voiceURI;
      saveSetting("jeeves-voice", voiceURI);
    }
  }
  updateSpeakButtons();
  speakNow("Good day. At your service.");
}

function makeToolButton(id, handler) {
  const button = document.createElement("button");
  button.id = id;
  button.onclick = handler;
  button.className = "jeeves-tool-button";
  button.textContent = id === "stylebtn" ? "Voice style" : "Voice source";
  button.setAttribute("aria-label", id === "stylebtn" ? "Change spoken voice style" : "Change spoken voice source");
  document.getElementById("tools").appendChild(button);
}

makeToolButton("stylebtn", cycleProfile);
makeToolButton("voicebtn", cycleVoice);

if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = updateSpeakButtons;

const originalSend = send;
send = async function () {
  const before = document.querySelectorAll("#chat .msg").length;
  await originalSend();
  const messages = document.querySelectorAll("#chat .msg");
  const last = messages[messages.length - 1];
  if (
    messages.length > before + 1 &&
    last.classList.contains("bot") &&
    !last.textContent.startsWith("AI error") &&
    !last.textContent.startsWith("Could not")
  ) {
    speak(last.textContent);
  }
};

updateSpeakButtons();


// Long-press an icon to reveal its description; a normal tap still activates it.
(function attachLongPressDescriptions() {
  let timer = null;
  let activeTip = null;
  function hideTip() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (activeTip) activeTip.remove();
    activeTip = null;
  }
  document.querySelectorAll("#tools .tool-icon").forEach(function (button) {
    button.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse") return;
      hideTip();
      timer = setTimeout(function () {
        const tip = document.createElement("span");
        tip.className = "tool-longpress-tip";
        tip.textContent = button.getAttribute("data-description") || button.getAttribute("aria-label") || "Setting";
        button.appendChild(tip);
        activeTip = tip;
      }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
      button.addEventListener(name, function () {
        if (timer) clearTimeout(timer);
        timer = null;
        if (activeTip) setTimeout(hideTip, 1400);
      });
    });
    button.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  });
})();


// Delegated long-press help also covers buttons added after page load (Location and Photo).
(function attachDynamicLongPressHelp() {
  const bar = document.getElementById("tools");
  if (!bar) return;
  let timer = null;
  let tip = null;
  let target = null;
  function clearHelp() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (tip) tip.remove();
    tip = null;
    target = null;
  }
  bar.addEventListener("pointerdown", function (event) {
    const button = event.target.closest("button.tool-icon");
    if (!button || event.pointerType === "mouse") return;
    clearHelp();
    target = button;
    timer = setTimeout(function () {
      if (!target) return;
      tip = document.createElement("span");
      tip.className = "tool-longpress-tip";
      tip.textContent = target.getAttribute("data-description") || target.getAttribute("aria-label") || "Setting";
      target.appendChild(tip);
    }, 550);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
    bar.addEventListener(name, function () {
      if (timer) clearTimeout(timer);
      timer = null;
      if (tip) setTimeout(clearHelp, 1400);
    });
  });
  bar.addEventListener("contextmenu", function (event) {
    if (event.target.closest("button.tool-icon")) event.preventDefault();
  });
})();
