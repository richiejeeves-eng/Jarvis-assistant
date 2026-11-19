async function showMemories() {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("memories")
    .select("id, content, category, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    addMessage("Memory error: " + error.message, "bot");
    return;
  }

  const box = addMessage("JEEVES MEMORY MANAGER", "bot");
  box.classList.add("memory-manager");

  const intro = document.createElement("p");
  intro.textContent = "Review and maintain what JEEVES remembers. Changes apply to future conversations.";
  box.appendChild(intro);

  const toolbar = document.createElement("div");
  toolbar.className = "memory-toolbar";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search memories...";
  search.setAttribute("aria-label", "Search memories");

  const category = document.createElement("select");
  category.setAttribute("aria-label", "Filter memories by category");
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All categories";
  category.appendChild(allOption);

  const categories = Array.from(new Set((data || []).map(function (item) {
    return item.category || "uncategorised";
  }))).sort();
  categories.forEach(function (name) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    category.appendChild(option);
  });

  const addButton = makeButton("+ Add memory", async function () {
    const content = window.prompt("What should JEEVES remember?");
    if (!content || !content.trim()) return;
    const cleanContent = content.trim().slice(0, 2000);
    const categoryName = (window.prompt("Category (for example: preferences, goals, projects, personal)", "personal") || "personal").trim().slice(0, 60) || "personal";
    const { error: insertError } = await db.from("memories").insert({
      content: cleanContent,
      category: categoryName
    });
    if (insertError) {
      addNote("Could not add memory: " + insertError.message);
      return;
    }
    addNote("Memory added.");
    await showMemories();
  });

  toolbar.append(search, category, addButton);
  box.appendChild(toolbar);

  const count = document.createElement("p");
  count.className = "memory-count";
  box.appendChild(count);

  const list = document.createElement("div");
  list.className = "memory-list";
  box.appendChild(list);

  function render() {
    list.textContent = "";
    const term = search.value.trim().toLowerCase();
    const selectedCategory = category.value;
    const filtered = (data || []).filter(function (item) {
      const itemCategory = item.category || "uncategorised";
      return (!selectedCategory || itemCategory === selectedCategory) &&
        (!term || item.content.toLowerCase().includes(term) || itemCategory.toLowerCase().includes(term));
    });

    count.textContent = filtered.length + " of " + (data || []).length + " memories shown" +
      ((data || []).length === 100 ? " (latest 100 loaded)" : "");

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = data.length ? "No memories match this filter." : "No memories saved yet. Add one to get started.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach(function (item) {
      const row = document.createElement("article");
      row.className = "memory-row";

      const details = document.createElement("div");
      details.className = "memory-details";

      const tag = document.createElement("small");
      tag.className = "memory-category";
      tag.textContent = item.category || "uncategorised";

      const content = document.createElement("p");
      content.textContent = item.content;

      const date = document.createElement("small");
      date.className = "memory-date";
      date.textContent = item.created_at ? new Date(item.created_at).toLocaleDateString() : "";

      details.append(tag, content, date);

      const actions = document.createElement("div");
      actions.className = "memory-actions";

      const editButton = makeButton("Edit", async function () {
        const revised = window.prompt("Edit this memory:", item.content);
        if (revised === null || !revised.trim()) return;
        const revisedCategory = window.prompt("Edit category:", item.category || "personal");
        if (revisedCategory === null) return;

        const { error: updateError } = await db.from("memories")
          .update({
            content: revised.trim().slice(0, 2000),
            category: revisedCategory.trim().slice(0, 60) || "personal"
          })
          .eq("id", item.id);

        if (updateError) {
          addNote("Could not update memory: " + updateError.message);
          return;
        }
        item.content = revised.trim().slice(0, 2000);
        item.category = revisedCategory.trim().slice(0, 60) || "personal";
        addNote("Memory updated.");
        render();
      });

      const deleteButton = makeButton("Delete", async function () {
        if (!window.confirm("Permanently delete this memory?")) return;
        const { error: deleteError } = await db.from("memories").delete().eq("id", item.id);
        if (deleteError) {
          addNote("Could not delete memory: " + deleteError.message);
          return;
        }
        const index = data.findIndex(function (memory) { return memory.id === item.id; });
        if (index !== -1) data.splice(index, 1);
        addNote("Memory deleted.");
        render();
      });

      actions.append(editButton, deleteButton);
      row.append(details, actions);
      list.appendChild(row);
    });
  }

  search.addEventListener("input", render);
  category.addEventListener("change", render);
  render();
  scrollChat();
}

async function showTasks(filter = "open") {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_at, source, google_task_id, google_tasklist_id, group_name")
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    addMessage("Task error: " + error.message, "bot");
    return;
  }

  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const matching = data.filter(function (task) {
    if (!task.due_at) return filter === "open";
    const due = new Date(task.due_at);
    if (filter === "overdue") return due < now;
    if (filter === "today") return due >= start && due < end;
    return true;
  });
  const headingText = filter === "overdue" ? "OVERDUE TASKS" : filter === "today" ? "TASKS DUE TODAY" : "YOUR OPEN TASKS";
  if (matching.length === 0) {
    addMessage(filter === "overdue" ? "No overdue tasks." : filter === "today" ? "No tasks due today." : "No pending tasks.", "bot");
    scrollChat();
    return;
  }

  const box = addMessage(headingText, "bot");
  box.classList.add("task-groups");

  const groups = new Map();
  matching.forEach(function (task) {
    const group = task.group_name || (task.source === "google_tasks" ? "Google Tasks" : "Jeeves tasks");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(task);
  });

  groups.forEach(function (tasks, groupName) {
    const section = document.createElement("section");
    section.className = "task-group";

    const heading = document.createElement("h3");
    heading.className = "task-group-heading";
    heading.textContent = groupName + " (" + tasks.length + ")";
    section.appendChild(heading);

    tasks.forEach(function (task) {
      const row = document.createElement("div");
      row.className = "taskrow";

      const label = document.createElement("span");
      let text = "• " + task.title;
      if (task.due_at) text += "\n   due " + new Date(task.due_at).toLocaleString();
      label.textContent = text + (task.source === "google_tasks" ? "\n   ↳ Google Tasks" : "");

      const buttons = document.createElement("div");

      const doneButton = makeButton("Done", async function () {
        if (task.google_task_id && task.google_tasklist_id) {
          const remote = await db.functions.invoke("google-calendar", {
            body: { action: "completeTask", google_task_id: task.google_task_id, google_tasklist_id: task.google_tasklist_id }
          });
          if (remote.error) {
            addMessage("Could not complete Google Task: " + remote.error.message, "bot");
            return;
          }
        }
        const { error: updateError } = await db.from("tasks").update({ status: "done" }).eq("id", task.id);
        if (updateError) {
          addMessage("Task error: " + updateError.message, "bot");
          return;
        }
        label.className = "done";
        buttons.remove();
        if (typeof speak === "function") speak("Completed: " + task.title);
        checkAlerts();
      });

      const deleteButton = makeButton("Delete", async function () {
        if (!confirm("Delete this task?")) return;
        const { error: deleteError } = await db.from("tasks").delete().eq("id", task.id);
        if (deleteError) {
          addMessage("Task error: " + deleteError.message, "bot");
          return;
        }
        row.remove();
        heading.textContent = groupName + " (" + section.querySelectorAll(".taskrow").length + ")";
        checkAlerts();
      });

      buttons.append(doneButton, deleteButton);
      row.append(label, buttons);
      section.appendChild(row);
    });

    box.appendChild(section);
  });
  scrollChat();
}

document.getElementById("command").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    send();
  }
});

setInterval(checkAlerts, 60000);

addMessage("JARVIS online. How can I help?", "bot");