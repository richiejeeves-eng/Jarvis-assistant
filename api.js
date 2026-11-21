// Small browser-side client for the versioned Jeeves API.
(function () {
  "use strict";

  window.jeevesApi = Object.freeze({
    call: async function (service, payload) {
      if (typeof db === "undefined" || !db || !db.functions) {
        throw new Error("Jeeves API client is not ready.");
      }
      return db.functions.invoke("jeeves-api", {
        body: { version: "v1", service: service, payload: payload || {} }
      });
    }
  });
})();
