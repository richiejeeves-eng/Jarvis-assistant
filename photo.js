(function () {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read the photo.")); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error("Could not open that image.")); };
        img.onload = function () {
          const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function askAboutPhoto(file) {
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session) {
      addMessage("Please sign in first (tap the Account bar at the top).", "bot");
      return;
    }

    const box = document.getElementById("command");
    let question = box.value.trim();
    if (!question) {
      question = prompt("What would you like to know about this photo?", "What is in this photo?");
    }
    if (!question) return;
    box.value = "";

    addMessage("📷 " + question, "user");
    const thinking = addMessage("Jeeves is looking at your photo...", "bot");

    let imageData;
    try {
      imageData = await shrinkImage(file);
    } catch (e) {
      thinking.textContent = "Photo error: " + e.message;
      return;
    }

    const { data, error } = await db.functions.invoke("jarvis-brain", {
      body: {
        message: question,
        image: { mime: "image/jpeg", data: imageData },
        history: [],
        now: new Date().toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

    if (error) {
      let detail = error.message;
      try {
        const body = await error.context.json();
        if (body && body.error) detail = body.error;
      } catch (e) {}
      thinking.textContent = "AI error: " + detail;
      return;
    }

    thinking.textContent = data.reply;
    if (typeof speak === "function") speak(data.reply);
  }

  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) askAboutPhoto(file);
  });

  const button = document.createElement("button");
  button.id = "photobtn";
  button.textContent = "📷";
  button.className = "tool-icon";
  button.setAttribute("aria-label", "Choose a photo");
  button.setAttribute("data-description", "Choose a photo to ask Jeeves about");
  button.onclick = function () { fileInput.click(); };

  const toolsBar = document.getElementById("tools");
  if (toolsBar) toolsBar.appendChild(button);
})();