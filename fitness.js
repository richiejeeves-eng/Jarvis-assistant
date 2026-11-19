(function () {
  const $ = (id) => document.getElementById(id);
  const fields = {
    steps: ["fitness-steps", "fitness-steps-meta"],
    heart_rate: ["fitness-heart", "fitness-heart-meta"],
    weight: ["fitness-weight", "fitness-weight-meta"],
    sleep: ["fitness-sleep", "fitness-sleep-meta"]
  };
  const sourceNames = {
    "com.sec.android.app.shealth": "Samsung Health",
    "com.hihonor.health": "HONOR Health",
    "com.myfitnesspal.android": "MyFitnessPal",
    "com.google.android.apps.fitness": "Google Fit",
    "Health Connect": "Health Connect"
  };
  function set(type, value, meta) {
    const ids = fields[type];
    if (!ids) return;
    if ($(ids[0])) $(ids[0]).textContent = value;
    if ($(ids[1])) $(ids[1]).textContent = meta || "No data yet";
  }
  function dateLabel(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" :
      date.toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
  }
  function sourceLabel(row) {
    return sourceNames[row.source_app] || row.source_app || "Connected source";
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
    if (!row) { set(type, "—", "No records synced"); return; }
    const value = row.value || {};
    const meta = sourceLabel(row) + " · " + dateLabel(row.start_time);
    if (type === "steps") set(type, Number.isFinite(Number(value.count)) ? Number(value.count).toLocaleString("en-GB") : "—", meta);
    if (type === "heart_rate") {
      const samples = Array.isArray(value.samples) ? value.samples : [];
      const sample = samples.length ? samples[samples.length - 1] : null;
      set(type, sample && Number.isFinite(Number(sample.bpm)) ? Math.round(Number(sample.bpm)) + " bpm" : "—", meta);
    }
    if (type === "weight") set(type, Number.isFinite(Number(value.kg)) && Number(value.kg) > 0 ? Number(value.kg).toFixed(1) + " kg" : "—", meta);
    if (type === "sleep") {
      const minutes = Number(value.duration_minutes);
      set(type, Number.isFinite(minutes) && minutes > 0 ? (minutes / 60).toFixed(1) + " hrs" : "—", meta);
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
        Object.keys(fields).forEach((type) => set(type, "—", "Sign in to view"));
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
    $("fitness-refresh")?.addEventListener("click", refresh);
    refresh();
    if (typeof db !== "undefined" && db.auth) {
      db.auth.onAuthStateChange((event) => {
        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "INITIAL_SESSION"].includes(event)) setTimeout(refresh, 150);
      });
    }
  });
  window.refreshJeevesFitness = refresh;
})();