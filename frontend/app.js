const BASE = "/service";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setResult(id, content, type) {
  const target = document.getElementById(id);
  target.className = "result " + type;
  if (typeof content === "string") {
    target.textContent = content;
  } else {
    target.replaceChildren(content);
  }
}

async function errorMessage(res) {
  const text = await res.text();
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text || "Request failed";
  }
}

// ADD USER
document.getElementById("btn-add-user").addEventListener("click", async () => {
  const name = document.getElementById("add-name").value.trim();
  const studentId = document.getElementById("add-student-id").value.trim();

  if (!name || !studentId) {
    setResult("result-add-user", "Fill in both fields.", "err");
    return;
  }

  setResult("result-add-user", "Adding user...", "loading");

  try {
    const res = await fetch(`${BASE}/user-service/add/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, studentId }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    setResult("result-add-user", await res.text(), "ok");
  } catch (err) {
    setResult("result-add-user", err.message, "err");
  }
});

// ADD TASK
document.getElementById("btn-add-task").addEventListener("click", async () => {
  const studentId = document.getElementById("task-student-id").value.trim();
  const task = document.getElementById("task-text").value.trim();

  if (!studentId || !task) {
    setResult("result-add-task", "Fill in both fields.", "err");
    return;
  }

  setResult("result-add-task", "Adding task...", "loading");

  try {
    const res = await fetch(`${BASE}/task-service/add/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, task }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    setResult("result-add-task", await res.text(), "ok");
  } catch (err) {
    setResult("result-add-task", err.message, "err");
  }
});

// SHOW USER
document.getElementById("btn-show-user").addEventListener("click", async () => {
  setResult("result-show-user", "Fetching...", "loading");

  try {
    const res = await fetch(`${BASE}/user-service/show/user`);
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      setResult("result-show-user", "No users found.", "err");
      return;
    }

    const list = document.createDocumentFragment();
    for (const u of data) {
      const row = el("div", "user-info");
      const name = el("span");
      name.append(el("b", null, u.name));
      const id = el("span", null, "Student ID: ");
      id.append(el("b", null, u.student_id));
      row.append(name, id);
      list.append(row);
    }

    setResult("result-show-user", list, "ok");
  } catch (err) {
    setResult("result-show-user", err.message, "err");
  }
});

// SHOW TASKS
document.getElementById("btn-show-tasks").addEventListener("click", async () => {
  setResult("result-show-tasks", "Fetching...", "loading");

  try {
    const res = await fetch(`${BASE}/task-service/show/task`);
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      setResult("result-show-tasks", "No tasks found.", "err");
      return;
    }

    const list = el("ul", "task-list");
    for (const t of data) {
      const item = el("li", null, t.task + " ");
      item.append(el("span", "muted", `(${t.studentId})`));
      list.append(item);
    }

    setResult("result-show-tasks", list, "ok");
  } catch (err) {
    setResult("result-show-tasks", err.message, "err");
  }
});
