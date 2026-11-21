// Browser client for the authenticated, path-versioned Jeeves API.
(function () {
  "use strict";

  const ROUTES = Object.freeze({
    brain: { path: "/v1/brain", method: "POST" },
    status: { path: "/v1", method: "GET" },
    calendar: { path: "/v1/google", method: "POST" },
    google: { path: "/v1/google", method: "POST" },
    health: { path: "/v1/health/sync", method: "POST" },
    healthNotify: { path: "/v1/health/notify", method: "POST" },
    voice: { path: "/v1/voice", method: "POST" }
  });

  window.jeevesApi = Object.freeze({
    call: async function (service, payload) {
      const route = ROUTES[service];
      if (!route) throw new Error("Unknown Jeeves API service: " + String(service));

      if (typeof db === "undefined" || !db || !db.auth) {
        throw new Error("Jeeves API client is not ready.");
      }
      const config = window.JEEVES_CONFIG;
      if (!config || !config.supabaseUrl || !config.supabasePublishableKey) {
        throw new Error("Jeeves API configuration is missing.");
      }
      const sessionResult = await db.auth.getSession();
      const session = sessionResult.data && sessionResult.data.session;
      if (sessionResult.error || !session) {
        return { data: null, error: { message: "Sign in required." } };
      }

      const headers = {
        "Authorization": "Bearer " + session.access_token,
        "apikey": config.supabasePublishableKey,
        "Accept": "application/json"
      };
      const options = { method: route.method, headers: headers, cache: "no-store" };
      if (route.method !== "GET") {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(payload || {});
      }

      let response;
      try {
        const baseUrl = config.supabaseUrl.endsWith("/")
          ? config.supabaseUrl.slice(0, -1)
          : config.supabaseUrl;
        response = await fetch(baseUrl + "/functions/v1/jeeves-api" + route.path, options);
      } catch (error) {
        return { data: null, error: { message: "Jeeves API is unreachable: " + (error.message || "network error") } };
      }

      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { message: raw.slice(0, 500) }; }
      if (!response.ok) {
        return {
          data: null,
          error: {
            message: data && data.error ? data.error : "Jeeves API request failed (" + response.status + ").",
            context: { json: async function () { return data; }, status: response.status }
          }
        };
      }
      return { data: data, error: null };
    }
  });
})();
