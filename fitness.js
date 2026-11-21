(function () {
  const $ = (id) => document.getElementById(id);
  const fields = {
    steps: "fitness-steps",
    heart_rate: "fitness-heart",
    weight: "fitness-weight",
    sleep: "fitness-sleep"
  };
  function set(type, value) {
    const id = fields[type];
    if (id && $(id)) $(id).textContent = value;
  }
  function dateLabel(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" :
      date.toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
  }
  async function latest(type) {
    const result = await db.from("health_records")
      .select("record_type,source_app,start_time,end_time,value,recorded_at")
      .eq("record_type", type)
      .order("start_time", { ascending: false })
      .limit(1);
    if (result.error) throw result.error;
    return result.data && result.data[0] ? result.data[0] : null;
  }
  function showRecord(type, row) {
    if (!row) { set(type, "—"); return; }
    const value = row.value || {};
    if (type === "steps") set(type, Number.isFinite(Number(value.count)) ? Number(value.count).toLocaleString("en-GB") : "—");
    if (type === "heart_rate") {
      const samples = Array.isArray(value.samples) ? value.samples : [];
      const sample = samples.length ? samples[samples.length - 1] : null;
      set(type, sample && Number.isFinite(Number(sample.bpm)) ? Math.round(Number(sample.bpm)) + " bpm" : "—");
    }
    if (type === "weight") set(type, Number.isFinite(Number(value.kg)) && Number(value.kg) > 0 ? Number(value.kg).toFixed(1) + " kg" : "—");
    if (type === "sleep") {
      const minutes = Number(value.duration_minutes);
      set(type, Number.isFinite(minutes) && minutes > 0 ? (minutes / 60).toFixed(1) + " hrs" : "—");
    }
  }
  async function refresh() {
    const status = $("fitness-updated");
    const button = $("fitness-refresh");
    if (!status || typeof db === "undefined") return;
    if (button) button.disabled = true;
    status.textContent = "Loading your private health records…";
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        Object.keys(fields).forEach((type) => set(type, "—"));
        status.textContent = "Sign in to load your health data.";
        return;
      }
      const types = Object.keys(fields);
      const rows = await Promise.all(types.map(latest));
      rows.forEach((row, index) => showRecord(types[index], row));
      const sync = await db.from("health_records")
        .select("recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(1);
      if (sync.error) throw sync.error;
      const last = sync.data && sync.data[0] ? sync.data[0].recorded_at : null;
      status.textContent = last
        ? "Live health records · last sync " + dateLabel(last)
        : "Connected, but no health records have synced yet.";
    } catch (error) {
      status.textContent = "Health data unavailable: " + (error.message || "Unknown error");
    } finally {
      if (button) button.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("fitness-refresh")?.addEventListener("click", triggerSync);
    refresh();
    if (typeof db !== "undefined" && db.auth) {
      db.auth.onAuthStateChange((event) => {
        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "INITIAL_SESSION"].includes(event)) setTimeout(refresh, 150);
      });
    }
  });
  let syncInProgress = false;
  async function triggerSync() {
    const status = $("fitness-updated");
    const button = $("fitness-refresh");
    if (syncInProgress || typeof db === "undefined") return;
    syncInProgress = true;
    if (button) button.disabled = true;
    const finish = () => { syncInProgress = false; if (button) button.disabled = false; };
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error("Sign in to Jeeves before syncing.");
      const queued = await db.from("health_sync_requests")
        .insert({ user_id: data.session.user.id, status: "queued" }).select("id").single();
      if (queued.error) throw queued.error;
      const requestId = queued.data.id;
      let pushMessage = "";
      try {
        const push = await window.jeevesApi.call("healthNotify", { request_id: requestId });
        if (push.error) throw push.error;
        if (!push.data || Number(push.data.sent || 0) < 1) {
          pushMessage = " No registered phone notification was confirmed.";
        }
      } catch (pushError) {
        pushMessage = " Push notification error: " + (pushError?.message || String(pushError)).slice(0, 240);
      }
      if (status) status.textContent = "Sync requested · notifying Jeeves Health…" + pushMessage;
      const started = Date.now();
      const check = async () => {
        try {
          const result = await db.from("health_sync_requests").select("status,error").eq("id", requestId).single();
          if (result.error) throw result.error;
          if (result.data.status === "completed") {
            await refresh();
            if (status) status.textContent = "Health Connect sync completed · dashboard refreshed.";
            finish(); return;
          }
          if (result.data.status === "failed") {
            if (status) status.textContent = "Health sync failed: " + (result.data.error || "Open Jeeves Health to check the error.");
            finish(); return;
          }
          if (Date.now() - started > 120000) {
            if (status) status.textContent = "Sync request queued. Open Jeeves Health on your Android phone; it will pick up the request while open.";
            finish(); return;
          }
          window.setTimeout(check, 5000);
        } catch (error) {
          if (status) status.textContent = "Could not check sync status: " + (error.message || "Unknown error");
          finish();
        }
      };
      window.setTimeout(check, 4000);
    } catch (error) {
      if (status) status.textContent = "Could not request health sync: " + (error.message || "Unknown error");
      finish();
    }
  }
  window.refreshJeevesFitness = refresh;
  window.triggerJeevesHealthSync = triggerSync;
})();