(function () {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  const cameraInput = document.createElement("input");
  cameraInput.type = "file";
  cameraInput.accept = "image/*";
  cameraInput.capture = "environment";
  cameraInput.style.display = "none";
  document.body.appendChild(cameraInput);

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
    // Persist the text exchange in the active conversation; the image itself is not retained.
    let persistConversation = false;
    try {
      if (!activeConversationId) await createConversation(question);
      await saveConversationMessage("user", "📷 " + question);
      persistConversation = true;
    } catch (saveError) {
      thinking.textContent = "Could not save this photo question: " + saveError.message;
      return;
    }

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
    if (persistConversation) {
      try {
        const {data: saved,error:saveError}=await db.from("conversation_messages").insert({
          conversation_id: activeConversationId, role:"assistant", content:data.reply
        }).select("id").single();
        if (saveError) throw saveError;
        thinking.dataset.messageId=saved.id;
        const {error:updateError}=await db.from("conversations").update({updated_at:new Date().toISOString()}).eq("id",activeConversationId);
        if (updateError) throw updateError;
      } catch(saveError) {
        addMessage("The photo response was generated but could not be saved: "+saveError.message,"bot");
      }
    }
    if (typeof speak === "function") speak(data.reply);
  }

  function handleSelectedImage(input) {
    input.addEventListener("change", function () {
      const file = input.files[0];
      input.value = "";
      if (file) askAboutPhoto(file);
    });
  }
  handleSelectedImage(fileInput);
  handleSelectedImage(cameraInput);

  const toolsBar = document.getElementById("tools");
  const uploadButton = document.createElement("button");
  uploadButton.id = "photobtn";
  uploadButton.textContent = "Upload Image";
  uploadButton.className = "jeeves-tool-button";
  uploadButton.setAttribute("aria-label", "Upload an image");
  uploadButton.setAttribute("data-description", "Choose an image from your device to ask Jeeves about");
  uploadButton.onclick = function () { fileInput.click(); };

  const cameraButton = document.getElementById("camerabtn");
  if (cameraButton) {
    cameraButton.textContent = "Camera";
    cameraButton.className = "jeeves-tool-button";
    cameraButton.setAttribute("aria-label", "Take a photo");
    cameraButton.setAttribute("data-description", "Take a photo with your camera");
    cameraButton.onclick = function () { cameraInput.click(); };
  }

  if (toolsBar) toolsBar.appendChild(uploadButton);
})();