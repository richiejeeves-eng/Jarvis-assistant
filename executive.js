(function () {
  const $ = (id) => document.getElementById(id);
  const dateText = (value) => value ? new Date(value).toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "No due date";
  function setMetric(id, value) { const el = $(id); if (el) el.textContent = String(value); }
  function renderTasks(tasks) {
    const list = $("executive-task-list");
    if (!list) return;
    list.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "executive-empty";
      empty.textContent = "No open tasks. Add a task through Jeeves when something needs tracking.";
      list.appendChild(empty);
      return;
    }
    tasks.slice(0, 5).forEach((task) => {
      const row = document.createElement("article");
      row.className = "executive-task-row";
      const title = document.createElement("strong");
      title.textContent = task.title || "Untitled task";
      const due = document.createElement("span");
      due.textContent = dateText(task.due_at);
      if (task.due_at && new Date(task.due_at) < new Date()) due.className = "is-overdue";
      row.append(title, due);
      list.appendChild(row);
    });
  }
  async function refresh() {
    const updated = $("executive-updated");
    if (!updated || typeof db === "undefined") return;
    const refreshButton = $("executive-refresh");
    if (refreshButton) refreshButton.disabled = true;
    try {
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        ["metric-open","metric-overdue","metric-today","metric-memories"].forEach((id) => setMetric(id, "—"));
        renderTasks([]);
        updated.textContent = "Sign in to load your private data.";
        return;
      }
      const [taskResult, memoryResult] = await Promise.all([
        db.from("tasks").select("id,title,due_at,status").eq("status","pending").order("due_at",{ascending:true,nullsFirst:false}).limit(100),
        db.from("memories").select("id",{count:"exact",head:true})
      ]);
      if (taskResult.error) throw taskResult.error;
      if (memoryResult.error) throw memoryResult.error;
      const tasks = taskResult.data || [];
      const now = new Date();
      const start = new Date(now); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(end.getDate()+1);
      const overdue = tasks.filter((task) => task.due_at && new Date(task.due_at) < now);
      const today = tasks.filter((task) => task.due_at && new Date(task.due_at) >= start && new Date(task.due_at) < end);
      setMetric("metric-open", tasks.length);
      setMetric("metric-overdue", overdue.length);
      setMetric("metric-today", today.length);
      setMetric("metric-memories", memoryResult.count ?? 0);
      renderTasks(tasks);
      updated.textContent = "Live data · refreshed " + new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    } catch (error) {
      updated.textContent = "Could not load live data: " + (error.message || "Unknown error");
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("executive-refresh")?.addEventListener("click", refresh);
    $("executive-view-tasks")?.addEventListener("click", () => { if (typeof showTasks === "function") showTasks(); });
    refresh();
    if (typeof db !== "undefined" && db.auth) db.auth.onAuthStateChange((event) => {
      if (["SIGNED_IN","SIGNED_OUT","TOKEN_REFRESHED","INITIAL_SESSION"].includes(event)) setTimeout(refresh, 100);
    });
  });
  window.refreshJeevesExecutiveBrief = refresh;
})();