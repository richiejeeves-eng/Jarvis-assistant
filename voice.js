let jeevesRecognition = null;
let jeevesVoiceActive = false;
let jeevesVoiceReplyInProgress = false;
let jeevesRestartTimer = null;

function setVoiceStage(active, transcript) {
  const workspace = document.querySelector(".workspace");
  const stage = document.getElementById("voice-stage");
  const preview = document.getElementById("voice-live-preview");
  const status = document.getElementById("voice-stage-status");
  if (!workspace || !stage) return;
  workspace.classList.toggle("voice-active", active);
  stage.setAttribute("aria-hidden", String(!active));
  if (preview && transcript !== undefined) preview.textContent = transcript || "Speak naturally…";
  if (status) status.textContent = active ? (jeevesVoiceReplyInProgress ? "JEEVES IS SPEAKING" : "LISTENING — SPEAK NATURALLY") : "";
}

function updateMicButton() {
  const micButton = document.getElementById("micbtn");
  if (!micButton) return;
  micButton.textContent = jeevesVoiceActive ? "Leave conversation" : "Speak";
  micButton.setAttribute("aria-label", jeevesVoiceActive ? "End continuous voice conversation" : "Start continuous voice conversation");
}

function launchRecognition() {
  if (!jeevesVoiceActive || jeevesVoiceReplyInProgress || jeevesRecognition) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    jeevesVoiceActive = false;
    updateMicButton();
    addMessage("Continuous voice input is not supported in this browser.", "bot");
    return;
  }
  const recognition = new Recognition();
  jeevesRecognition = recognition;
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = function (event) {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    setVoiceStage(true, finalText || interim || "");
    if (finalText.trim()) {
      const input = document.getElementById("command");
      input.value = (input.value.trim() + " " + finalText.trim()).trim();
    }
  };

  recognition.onerror = function (event) {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      console.warn("Jeeves voice recognition:", event.error);
    }
  };

  recognition.onend = function () {
    if (jeevesRecognition === recognition) jeevesRecognition = null;
    if (!jeevesVoiceActive) return;
    const input = document.getElementById("command");
    if (input && input.value.trim() && !jeevesVoiceReplyInProgress) {
      jeevesVoiceReplyInProgress = true;
      setVoiceStage(true, "Preparing your reply…");
      updateMicButton();
      send();
      return;
    }
    if (!jeevesVoiceReplyInProgress) {
      clearTimeout(jeevesRestartTimer);
      jeevesRestartTimer = setTimeout(launchRecognition, 350);
    }
  };

  try {
    recognition.start();
    setVoiceStage(true, "");
    updateMicButton();
  } catch (error) {
    if (jeevesRecognition === recognition) jeevesRecognition = null;
    if (jeevesVoiceActive) {
      clearTimeout(jeevesRestartTimer);
      jeevesRestartTimer = setTimeout(launchRecognition, 700);
    }
  }
}

function startVoice() {
  if (jeevesVoiceActive) {
    jeevesVoiceActive = false;
    jeevesVoiceReplyInProgress = false;
    clearTimeout(jeevesRestartTimer);
    if (jeevesRecognition) {
      const active = jeevesRecognition;
      jeevesRecognition = null;
      try { active.stop(); } catch (e) {}
    }
    setVoiceStage(false);
    updateMicButton();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    addMessage("Voice input is not supported in this browser. Try Chrome on Android or desktop Chrome.", "bot");
    return;
  }
  jeevesVoiceActive = true;
  jeevesVoiceReplyInProgress = false;
  updateMicButton();
  launchRecognition();
}

window.jeevesVoiceIsActive = function () { return jeevesVoiceActive; };
window.jeevesResumeListening = function () {
  if (!jeevesVoiceActive) return;
  jeevesVoiceReplyInProgress = false;
  setVoiceStage(true, "");
  updateMicButton();
  clearTimeout(jeevesRestartTimer);
  jeevesRestartTimer = setTimeout(launchRecognition, 300);
};
window.jeevesVoiceStopListening = function () {
  jeevesVoiceReplyInProgress = true;
  if (jeevesRecognition) {
    const active = jeevesRecognition;
    jeevesRecognition = null;
    try { active.stop(); } catch (e) {}
  }
};
