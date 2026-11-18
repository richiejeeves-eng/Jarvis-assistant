function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micButton = document.getElementById("micbtn");

  if (!Recognition) {
    addMessage("Voice input is not supported in this browser.", "bot");
    return;
  }

  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  micButton.textContent = "Listening...";
  micButton.disabled = true;

  recognition.onresult = function (event) {
    const text = event.results[0][0].transcript;
    document.getElementById("command").value = text;
  };

  recognition.onerror = function (event) {
    addMessage("Voice error: " + event.error, "bot");
  };

  recognition.onend = function () {
    micButton.textContent = "🎤";
    micButton.disabled = false;
  };

  recognition.start();
}