(function () {
  const button = document.getElementById("locationbtn");
  if (!button) return;

  button.addEventListener("click", function () {
    if (!navigator.geolocation) {
      if (typeof addNote === "function") addNote("Location sharing is not supported by this browser.");
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Finding location…";
    navigator.geolocation.getCurrentPosition(function (position) {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      const accuracy = Math.round(position.coords.accuracy);
      const input = document.getElementById("command");
      const question = input.value.trim();
      const locationText = "My current location is latitude " + latitude + ", longitude " + longitude + " (accuracy approximately " + accuracy + " metres).";
      input.value = question ? question + "\n\n" + locationText : locationText + " Please use this location for my next request.";
      if (typeof quickPrompt === "function") quickPrompt(input.value);
      else input.focus();
      if (typeof addNote === "function") addNote("Your location has been added to the message. Review it, then press Send.");
      button.disabled = false;
      button.textContent = original;
    }, function (error) {
      const reasons = {
        1: "Location permission was denied. Allow location access in your browser settings and try again.",
        2: "Your device could not determine its location. Try again outdoors or check device location settings.",
        3: "Location request timed out. Please try again."
      };
      if (typeof addNote === "function") addNote(reasons[error.code] || "Could not retrieve your location.");
      button.disabled = false;
      button.textContent = original;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
})();