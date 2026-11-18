let speakOn = false;
try {
  speakOn = localStorage.getItem("jeeves-speak") === "on";
} catch (e) {}

function updateSpeakButton() {
  const button = document.getElementById("speakbtn");
  if (button) button.textContent = speakOn ? "🔊 Voice on" : "🔇 Voice off";
}

function toggleSpeak() {
  speakOn = !speakOn;
  try {
    localStorage.setItem("jeeves-speak", speakOn ? "on" : "off");
  } catch (e) {}
  if (!speakOn && window.speechSynthesis) window.speechSynthesis.cancel();
  updateSpeakButton();
}

function speak(text) {
  if (!speakOn || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en-GB";
  window.speechSynthesis.speak(utterance);
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

updateSpeakButton();