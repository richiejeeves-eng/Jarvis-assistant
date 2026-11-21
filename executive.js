(function () {
  const $ = (id) => document.getElementById(id);
  const dateText = (value) => value ? new Date(value).toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "No due date";
  function setMetric(id, value) { const el = $(id); if (el) el.textContent = String(value); }
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
      updated.textContent = "Live data · refreshed " + new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    } catch (error) {
      updated.textContent = "Could not load live data: " + (error.message || "Unknown error");
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }
  async function openAccountView(kind) {
    if (kind === "tasks") kind = "open";
    const title = $("account-detail-title"), subtitle = $("account-detail-subtitle"), host = $("account-detail-content");
    if (!host) return;
    const labels = { open:["Open tasks","All currently pending tasks"], overdue:["Overdue tasks","Pending tasks past their due date"], today:["Due today","Pending tasks due today"], memories:["Saved memories","Your saved memory entries"] };
    const info = labels[kind] || labels.open;
    if(title) title.textContent=info[0];
    if(subtitle) subtitle.textContent=info[1];
    host.textContent="Loading your account data…";
    try {
      const {data:sessionData,error:sessionError}=await db.auth.getSession();
      if(sessionError) throw sessionError;
      if(!sessionData.session){host.textContent="Sign in to view this private account data.";return;}
      if(kind==="memories"){
        const {data,error}=await db.from("memories").select("id,content,category,created_at").order("created_at",{ascending:false}).limit(100);
        if(error) throw error;
        host.replaceChildren();
        if(!data?.length){host.textContent="No saved memories yet.";return;}
        data.forEach(item=>{const card=document.createElement("article");card.className="priority-card";const tag=document.createElement("span");tag.className="tag";tag.textContent=item.category||"uncategorised";const body=document.createElement("p");body.textContent=item.content||"";card.append(tag,body);host.appendChild(card);});
        return;
      }
      if (typeof db.functions?.invoke !== "function") throw new Error("Google Tasks connection is unavailable.");
      const sync = await window.jeevesApi.call("calendar", { action: "syncTasks" });
      if (sync.error) throw sync.error;
      const {data,error}=await db.from("tasks").select("id,title,due_at,source,group_name,google_task_id,google_tasklist_id").eq("status","pending").order("due_at",{ascending:true,nullsFirst:false}).limit(200);
      if(error) throw error;
      const now=new Date(),start=new Date(now);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
      const tasks=(data||[]).filter(task=>{if(kind==="overdue")return !!task.due_at&&new Date(task.due_at)<now;if(kind==="today")return !!task.due_at&&new Date(task.due_at)>=start&&new Date(task.due_at)<end;return true;});
      host.replaceChildren();
      const toolbar=document.createElement("div");toolbar.className="jeeves-task-toolbar";
      if(kind==="open"){
        const form=document.createElement("form");form.className="jeeves-task-add";
        const input=document.createElement("input");input.type="text";input.maxLength=500;input.placeholder="Add a Google task…";input.required=true;input.setAttribute("aria-label","New Google task");
        const add=document.createElement("button");add.type="submit";add.textContent="Add task";
        form.append(input,add);form.addEventListener("submit",async(event)=>{event.preventDefault();const title=input.value.trim();if(!title)return;add.disabled=true;add.textContent="Adding…";try{const result=await window.jeevesApi.call("calendar",{action:"createTask",title});if(result.error)throw result.error;await openAccountView("open");}catch(error){add.disabled=false;add.textContent="Add task";alert("Could not add Google Task: "+(error.message||"Unknown error"));}});toolbar.appendChild(form);
      }
      const syncButton=document.createElement("button");syncButton.type="button";syncButton.className="jeeves-task-sync";syncButton.textContent="Refresh Google Tasks ↻";syncButton.addEventListener("click",async()=>{syncButton.disabled=true;try{const result=await window.jeevesApi.call("calendar",{action:"syncTasks"});if(result.error)throw result.error;await openAccountView(kind);}catch(error){alert("Google Tasks sync failed: "+(error.message||"Unknown error"));syncButton.disabled=false;}});toolbar.appendChild(syncButton);host.appendChild(toolbar);
      if(!tasks.length){const empty=document.createElement("p");empty.textContent=kind==="overdue"?"No overdue tasks.":kind==="today"?"No tasks due today.":"No open tasks in Google Tasks.";host.appendChild(empty);return;}
      tasks.forEach(task=>{const row=document.createElement("article");row.className="executive-task-row";const details=document.createElement("div");details.className="jeeves-task-details";const name=document.createElement("strong");name.textContent=task.title||"Untitled task";const due=document.createElement("span");due.textContent=dateText(task.due_at);if(task.due_at&&new Date(task.due_at)<now)due.className="is-overdue";details.append(name,due);row.appendChild(details);
        const remove=document.createElement("button");remove.type="button";remove.className="jeeves-task-delete";remove.textContent="Delete";remove.disabled=!(task.google_task_id&&task.google_tasklist_id);remove.title=remove.disabled?"Sync this task with Google Tasks before deleting":"Delete from Google Tasks";
        remove.addEventListener("click",async()=>{if(!confirm("Delete this task from Google Tasks?"))return;remove.disabled=true;try{const result=await window.jeevesApi.call("calendar",{action:"deleteTask",task_id:task.id});if(result.error)throw result.error;await openAccountView(kind);}catch(error){alert("Could not delete task: "+(error.message||"Unknown error"));remove.disabled=false;}});
        row.appendChild(remove);host.appendChild(row);});
    } catch(error) { host.textContent="Could not load account data: "+(error.message||"Unknown error"); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("executive-refresh")?.addEventListener("click", refresh);
    document.querySelectorAll("[data-metric-action]").forEach((card) => {
      const activate = () => {
        const action = card.dataset.metricAction;
        if (typeof switchTab === "function") switchTab("account-" + action);
      };
      card.addEventListener("click", activate);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      });
    });
    refresh();
    if (typeof db !== "undefined" && db.auth) db.auth.onAuthStateChange((event) => {
      if (["SIGNED_IN","SIGNED_OUT","TOKEN_REFRESHED","INITIAL_SESSION"].includes(event)) setTimeout(refresh, 100);
    });
  });
  const taskStyle=document.createElement("style");taskStyle.textContent="\n.jeeves-task-toolbar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:0 0 16px}\n.jeeves-task-add{display:flex;flex:1 1 260px;gap:8px}\n.jeeves-task-add input{flex:1;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:#0b0d11;color:var(--white);font:inherit}\n.jeeves-task-add button,.jeeves-task-sync,.jeeves-task-delete{padding:9px 13px;border:1px solid var(--line);border-radius:9px;background:rgba(212,175,118,.1);color:var(--gold-light);font:500 12px 'Plus Jakarta Sans',sans-serif;cursor:pointer}\n.jeeves-task-sync{margin-left:auto}\n.executive-task-row{display:flex;justify-content:space-between;align-items:center;gap:12px}\n.jeeves-task-details{display:grid;gap:5px;min-width:0}\n.jeeves-task-delete{flex:0 0 auto;background:rgba(201,122,87,.1);color:#e3a28c;border-color:rgba(201,122,87,.3)}\n.jeeves-task-add button:disabled,.jeeves-task-sync:disabled,.jeeves-task-delete:disabled{opacity:.5;cursor:wait}\n";document.head.appendChild(taskStyle);
  window.openJeevesAccountView = openAccountView;
  window.refreshJeevesExecutiveBrief = refresh;
})();