async function showMemories() {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("memories")
    .select("id, content, category, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    addMessage("Memory error: " + error.message, "bot");
    return;
  }

  if (data.length === 0) {
    addMessage("JARVIS memory is empty.", "bot");
    return;
  }

  const box = addMessage("JARVIS REMEMBERS", "bot");

  data.forEach(function (item) {
    const row = document.createElement("div");
    row.className = "taskrow";

    const label = document.createElement("span");
    label.textContent = "• " + item.content;

    const deleteButton = makeButton("Delete", async function () {
      if (!confirm("Delete this memory?")) return;

      const { error: deleteError } = await db
        .from("memories")
        .delete()
        .eq("id", item.id);

      if (deleteError) {
        addMessage("Memory error: " + deleteError.message, "bot");
        return;
      }

      row.remove();
    });

    row.appendChild(label);
    row.appendChild(deleteButton);
    box.appendChild(row);
  });

  scrollChat();
}

async function showTasks() {
  if (!(await requireSession())) return;

  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_at")
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20);

  if (error) {
    addMessage("Task error: " + error.message, "bot");
    return;
  }

  if (data.length === 0) {
    addMessage("No pending tasks.", "bot");
    return;
  }

  const box = addMessage("YOUR TASKS", "bot");

  data.forEach(function (task) {
    const row = document.createElement("div");
    row.className = "taskrow";

    const label = document.createElement("span");
    let text = "• " + task.title;
    if (task.due_at) {
      text += "\n   due " + new Date(task.due_at).toLocaleString();
    }
    label.textContent = text;

    const buttons = document.createElement("div");

    const doneButton = makeButton("Done", async function () {
      const { error: updateError } = await db
        .from("tasks")
        .update({ status: "done" })
        .eq("id", task.id);

      if (updateError) {
        addMessage("Task error: " + updateError.message, "bot");
        return;
      }

      label.className = "done";
      buttons.remove();
      checkAlerts();
    });

    const deleteButton = makeButton("Delete", async function () {
      if (!confirm("Delete this task?")) return;

      const { error: deleteError } = await db
        .from("tasks")
        .delete()
        .eq("id", task.id);

      if (deleteError) {
        addMessage("Task error: " + deleteError.message, "bot");
        return;
      }

      row.remove();
      checkAlerts();
    });

    buttons.appendChild(doneButton);
    buttons.appendChild(deleteButton);
    row.appendChild(label);
    row.appendChild(buttons);
    box.appendChild(row);
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