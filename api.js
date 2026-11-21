// Small browser-side client for the authenticated Jeeves API.
(function () {
  "use strict";

  const ACTIONS = Object.freeze({
    brain: "ai.chat",
    status: "system.status",
    calendar: "google.action",
    google: "google.action",
    health: "health.sync",
    healthNotify: "health.notify",
    voice: "voice.generate"
  });

  window.jeevesApi = Object.freeze({
    call: async function (service, payload) {
      if (typeof db === "undefined" || !db || !db.functions) {
        throw new Error("Jeeves API client is not ready.");
      }
      const action = ACTIONS[service] || service;
      if (typeof action !== "string" || !action) {
        throw new Error("A valid Jeeves API action is required.");
      }
      return db.functions.invoke("jeeves-api", {
        body: { action: action, payload: payload || {} }
      });
    }
  });
})();
