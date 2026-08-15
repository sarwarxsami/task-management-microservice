const BASE = "https://task.sarwarxsami.me/service";

function setResult(id, content, type) {
  const el = document.getElementById(id);
  el.className = "result " + type;
  el.innerHTML = content;
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
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    setResult("result-add-user", text, "ok");
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
    const res = await fetch(`${BASE}/user-service/add/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, task }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    setResult("result-add-task", text, "ok");
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

    const html = data.map(u => `
      <div class="user-info" style="margin-bottom:10px">
        <span><b>${u.name}</b></span>
        <span>Student ID: <b>${u.student_id}</b></span>
      </div>
    `).join("");

    setResult("result-show-user", html, "ok");
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

    const items = data.map(t => `<li>${t.task} <span style="color:var(--muted)">(${t.studentId})</span></li>`).join("");
    const html = `<ul class="task-list">${items}</ul>`;
    setResult("result-show-tasks", html, "ok");
  } catch (err) {
    setResult("result-show-tasks", err.message, "err");
  }
});