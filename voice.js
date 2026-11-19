let jeevesRecognition = null;
let jeevesVoiceActive = false;

function setVoiceStage(active, transcript) {
  const workspace = document.querySelector(".workspace");
  const stage = document.getElementById("voice-stage");
  const preview = document.getElementById("voice-live-preview");
  const status = document.getElementById("voice-stage-status");
  if (!workspace || !stage) return;
  workspace.classList.toggle("voice-active", active);
  stage.setAttribute("aria-hidden", String(!active));
  if (preview && transcript !== undefined) preview.textContent = transcript || "Speak naturally…";
  if (status) status.textContent = active ? "JEEVES IS LISTENING" : "";
}

function startVoice() {
  const micButton = document.getElementById("micbtn");
  if (jeevesVoiceActive && jeevesRecognition) {
    jeevesVoiceActive = false;
    try { jeevesRecognition.stop(); } catch (e) {}
    setVoiceStage(false);
    micButton.textContent = "Speak";
    micButton.setAttribute("aria-label", "Start voice input");
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    addMessage("Voice input is not supported in this browser.", "bot");
    return;
  }

  const recognition = new Recognition();
  jeevesRecognition = recognition;
  jeevesVoiceActive = true;
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  micButton.textContent = "Stop";
  micButton.setAttribute("aria-label", "Stop voice input");
  setVoiceStage(true, "");
  recognition.onresult = function (event) {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    setVoiceStage(true, finalText || interim || "");
    if (finalText.trim()) document.getElementById("command").value = finalText.trim();
  };

  recognition.onerror = function (event) {
    addMessage("Voice error: " + event.error, "bot");
  };

  recognition.onend = function () {
    if (jeevesRecognition === recognition) jeevesRecognition = null;
    jeevesVoiceActive = false;
    setVoiceStage(false);
    micButton.textContent = "Speak";
    micButton.setAttribute("aria-label", "Start voice input");
    const input = document.getElementById("command");
    if (input.value.trim()) send();
  };

  try { recognition.start(); }
  catch (error) {
    jeevesVoiceActive = false;
    jeevesRecognition = null;
    setVoiceStage(false);
    micButton.textContent = "Speak";
    addMessage("Could not start voice input: " + error.message, "bot");
  }
}
