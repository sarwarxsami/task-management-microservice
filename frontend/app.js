const USERS = "/service/user-service";
const TASKS = "/service/task-service";
const SOCIAL = "/service/social-service";
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const VISIBILITY_LABEL = { only_me: "Only Me", trusted: "Trusted", open: "Open" };
const UNLISTED = "User is Unlisted";
const VIEWS = ["auth", "tasks", "discover", "space", "viewers", "account", "admin"];

const state = {
  token: null,
  user: null,
  tasks: [],
  users: [],
  status: "all",
  view: "tasks",
  people: [],
  space: null,
  backView: "discover",
};

const $ = (id) => document.getElementById(id);

// ---------- storage (best effort; private windows may throw) ----------

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message, type = "ok") {
  const box = $("toast");
  box.textContent = message;
  box.className = type;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3500);
}

class ApiError extends Error {
  constructor(status, message, sessionExpired = false) {
    super(message);
    this.status = status;
    this.sessionExpired = sessionExpired;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const message = (data && data.error) || text || `Request failed (${res.status})`;
    if (res.status === 401 && state.token) {
      logout("Your session has expired. Please log in again.");
      throw new ApiError(res.status, message, true);
    }
    throw new ApiError(res.status, message);
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function reportError(err) {
  if (!err.sessionExpired) toast(err.message, "err");
}

async function withBusy(form, fn) {
  const buttons = form.querySelectorAll("button");
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await fn();
  } catch (err) {
    reportError(err);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

function dueInfo(task) {
  if (!task.deadline) return null;
  const days = daysBetween(todayISO(), task.deadline);
  const date = new Date(task.deadline + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });

  if (task.completed) return { label: `Due ${date}`, cls: "" };
  if (days < 0) return { label: `Overdue · ${date}`, cls: "bad" };
  if (days === 0) return { label: "Due today", cls: "warn" };
  if (days === 1) return { label: "Due tomorrow", cls: "warn" };
  if (days <= 7) return { label: `Due in ${days} days`, cls: "" };
  return { label: `Due ${date}`, cls: "" };
}

function isOverdue(task) {
  return !task.completed && task.deadline && task.deadline < todayISO();
}

function isAdmin() {
  return state.user?.role === "admin";
}

// ---------- session ----------

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  store.set("tms.token", token);
}

function logout(message) {
  state.token = null;
  state.user = null;
  state.tasks = [];
  state.users = [];
  store.remove("tms.token");
  store.remove("tms.view");
  showView("auth");
  if (message) toast(message, "err");
}

// restore = reopen the last view (page reload); a fresh login starts on Tasks
async function startSession(restore = false) {
  $("nav-name").textContent = state.user.name;
  $("nav-role").textContent = state.user.role;
  $("nav-role").className = "badge " + state.user.role;
  $("nav-admin").hidden = !isAdmin();
  $("filter-user").hidden = !isAdmin();
  $("task-owner-field").hidden = !isAdmin();

  if (isAdmin()) await loadUsers();
  await loadTasks();
  refreshRequestBadge();

  if (!state.user.username) {
    await openView("account");
    return;
  }
  const last = restore ? store.get("tms.view") : null;
  await openView(["discover", "viewers"].includes(last) || (last === "admin" && isAdmin()) ? last : "tasks");
}

// Loads whatever a view needs, then shows it
async function openView(name) {
  if (state.token && !state.user.username && name !== "account") {
    toast("Choose a username first", "err");
    name = "account";
  }
  try {
    if (name === "admin") await loadUsers();
    if (name === "discover") await loadDiscover();
    if (name === "viewers") await loadViewers();
    if (name === "account") await loadSettings();
  } catch (err) {
    reportError(err);
    if (err.sessionExpired) return;
  }
  showView(name);
}

// ---------- views ----------

function showView(name) {
  state.view = name;
  const loggedIn = Boolean(state.token);
  $("nav").hidden = !loggedIn;

  for (const view of VIEWS) {
    $(`view-${view}`).hidden = view !== name;
  }
  document.querySelectorAll("#nav [data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "account") {
    $("profile-id").value = state.user.studentId;
    $("form-profile").elements.name.value = state.user.name;
    $("form-profile").elements.username.value = state.user.username || "";
    $("username-notice").hidden = Boolean(state.user.username);
  }
  if (name === "admin") renderUsers();
  if (name !== "auth" && name !== "space") store.set("tms.view", name);
  window.scrollTo(0, 0);
}

document.querySelectorAll("#nav [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => openView(btn.dataset.view));
});

$("btn-logout").addEventListener("click", () => logout());

// ---------- auth ----------

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const login = tab.dataset.authTab === "login";
    $("form-login").hidden = !login;
    $("form-register").hidden = login;
    document.querySelectorAll("[data-auth-tab]").forEach((t) => t.classList.toggle("active", t === tab));
  });
});

$("form-login").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const { token, user } = await api(`${USERS}/auth/login`, { method: "POST", body: formData(form) });
    saveSession(token, user);
    form.reset();
    await startSession();
    toast(`Welcome back, ${user.name}`);
  });
});

$("form-register").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const { token, user } = await api(`${USERS}/auth/register`, { method: "POST", body: formData(form) });
    saveSession(token, user);
    form.reset();
    await startSession();
    toast(`Account created. Welcome, ${user.name}`);
  });
});

// ---------- tasks ----------

function selectedOwner() {
  return isAdmin() ? $("filter-user").value : "";
}

async function loadTasks() {
  const owner = selectedOwner();
  const query = owner === "__all" ? "" : `?studentId=${encodeURIComponent(owner || state.user.studentId)}`;
  state.tasks = await api(`${TASKS}/tasks${query}`);
  renderTasks();
}

function visibleTasks() {
  const q = $("filter-search").value.trim().toLowerCase();
  const sort = $("filter-sort").value;

  const list = state.tasks.filter((t) => {
    if (state.status === "active" && t.completed) return false;
    if (state.status === "completed" && !t.completed) return false;
    if (state.status === "overdue" && !isOverdue(t)) return false;
    if (q && !`${t.title} ${t.description || ""} ${t.studentId}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const byCreated = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.id - a.id;
  const compare = {
    created: byCreated,
    deadline: (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || byCreated(a, b),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byCreated(a, b),
    title: (a, b) => a.title.localeCompare(b.title),
  }[sort];

  // open tasks first, completed at the bottom
  return list.sort((a, b) => Number(a.completed) - Number(b.completed) || compare(a, b));
}

function renderStats() {
  const today = todayISO();
  const open = state.tasks.filter((t) => !t.completed);
  $("stat-total").textContent = state.tasks.length;
  $("stat-active").textContent = open.length;
  $("stat-done").textContent = state.tasks.length - open.length;
  $("stat-today").textContent = open.filter((t) => t.deadline === today).length;
  $("stat-overdue").textContent = open.filter((t) => t.deadline && t.deadline < today).length;
}

function renderTasks() {
  renderStats();

  const owner = selectedOwner();
  const ownerName = state.users.find((u) => u.studentId === owner)?.name;
  $("tasks-title").textContent = owner === "__all" ? "All tasks" : ownerName && owner !== state.user.studentId ? `${ownerName}'s tasks` : "My tasks";
  $("btn-clear-done").hidden = !state.tasks.some((t) => t.completed && t.studentId === state.user.studentId);

  const list = $("task-list");
  const tasks = visibleTasks();
  list.replaceChildren(...tasks.map(renderTask));

  const empty = $("task-empty");
  empty.hidden = tasks.length > 0;
  empty.textContent = state.tasks.length === 0 ? "No tasks yet. Add your first one." : "No tasks match the current filters.";
}

function renderTask(task) {
  const item = $("tpl-task").content.firstElementChild.cloneNode(true);
  item.classList.toggle("done", task.completed);
  item.classList.toggle("overdue", Boolean(isOverdue(task)));

  const check = item.querySelector(".task-check");
  check.checked = task.completed;
  check.addEventListener("change", () => toggleTask(task, check));

  item.querySelector(".task-title").textContent = task.title;

  fillTaskPills(item, task);

  if (isAdmin() && task.studentId !== state.user.studentId) {
    const pill = item.querySelector(".owner");
    pill.textContent = state.users.find((u) => u.studentId === task.studentId)?.name || task.studentId;
    pill.title = task.studentId;
    pill.hidden = false;
  }

  item.querySelector('[data-action="edit"]').addEventListener("click", () => {
    item.replaceWith(renderEditor(task));
  });
  item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteTask(task));
  return item;
}

// Priority, visibility, due date and description, shared by own and others' tasks
function fillTaskPills(item, task) {
  const priority = item.querySelector(".priority");
  priority.textContent = task.priority;
  priority.classList.add(task.priority);

  const visibility = item.querySelector(".visibility");
  visibility.textContent = VISIBILITY_LABEL[task.visibility] || task.visibility;
  visibility.classList.add(`vis-${task.visibility}`);

  const due = dueInfo(task);
  if (due) {
    const pill = item.querySelector(".due");
    pill.textContent = due.label;
    if (due.cls) pill.classList.add(due.cls);
    pill.hidden = false;
  }

  if (task.description) {
    const desc = item.querySelector(".task-desc");
    desc.textContent = task.description;
    desc.hidden = false;
  }
}

function renderEditor(task) {
  const item = $("tpl-task-edit").content.firstElementChild.cloneNode(true);
  const form = item.querySelector("form");
  form.elements.title.value = task.title;
  form.elements.description.value = task.description || "";
  form.elements.deadline.value = task.deadline || "";
  form.elements.priority.value = task.priority;
  form.elements.visibility.value = task.visibility || "only_me";

  item.querySelector('[data-action="cancel"]').addEventListener("click", renderTasks);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(form, async () => {
      const data = formData(form);
      const updated = await api(`${TASKS}/tasks/${task.id}`, {
        method: "PUT",
        body: {
          title: data.title,
          description: data.description,
          deadline: data.deadline || null,
          priority: data.priority,
          visibility: data.visibility,
        },
      });
      replaceTask(updated);
      toast("Task updated");
    });
  });
  setTimeout(() => form.elements.title.focus(), 0);
  return item;
}

function replaceTask(updated) {
  state.tasks = state.tasks.map((t) => (t.id === updated.id ? updated : t));
  renderTasks();
}

async function toggleTask(task, check) {
  check.disabled = true;
  try {
    const updated = await api(`${TASKS}/tasks/${task.id}/status`, {
      method: "PATCH",
      body: { completed: check.checked },
    });
    replaceTask(updated);
  } catch (err) {
    check.checked = !check.checked;
    check.disabled = false;
    reportError(err);
  }
}

async function deleteTask(task) {
  if (!confirm(`Delete "${task.title}"?`)) return;
  try {
    await api(`${TASKS}/tasks/${task.id}`, { method: "DELETE" });
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    renderTasks();
    toast("Task deleted");
  } catch (err) {
    reportError(err);
  }
}

$("form-task").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const data = formData(form);
    const body = {
      title: data.title,
      description: data.description,
      deadline: data.deadline || null,
      priority: data.priority,
      visibility: data.visibility,
    };
    if (isAdmin() && data.studentId) body.studentId = data.studentId;

    await api(`${TASKS}/tasks`, { method: "POST", body });
    form.reset();
    if (isAdmin()) form.elements.studentId.value = state.user.studentId;
    await loadTasks();
    toast("Task added");
  });
});

$("btn-clear-done").addEventListener("click", async () => {
  if (!confirm("Delete all of your completed tasks?")) return;
  try {
    const { deleted } = await api(`${TASKS}/tasks/completed`, { method: "DELETE" });
    await loadTasks();
    toast(`Removed ${deleted} completed task${deleted === 1 ? "" : "s"}`);
  } catch (err) {
    reportError(err);
  }
});

document.querySelectorAll(".segmented [data-status]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.status = btn.dataset.status;
    document.querySelectorAll(".segmented [data-status]").forEach((b) => b.classList.toggle("active", b === btn));
    renderTasks();
  });
});

$("filter-search").addEventListener("input", renderTasks);
$("filter-sort").addEventListener("change", renderTasks);
$("filter-user").addEventListener("change", () => loadTasks().catch(reportError));

// ---------- account ----------

async function updateSelf(body, message) {
  const updated = await api(`${USERS}/users/${encodeURIComponent(state.user.studentId)}`, { method: "PUT", body });
  state.user = { ...state.user, name: updated.name, username: updated.username };
  $("nav-name").textContent = updated.name;
  $("username-notice").hidden = Boolean(updated.username);
  toast(message);
}

$("form-profile").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, () => updateSelf({
    name: form.elements.name.value,
    username: form.elements.username.value,
  }, "Profile updated"));
});

async function loadSettings() {
  const { listed } = await api(`${SOCIAL}/settings`);
  document.querySelectorAll('input[name="listed"]').forEach((r) => { r.checked = r.value === String(listed); });
}

document.querySelectorAll('input[name="listed"]').forEach((radio) => {
  radio.addEventListener("change", async () => {
    try {
      const { listed } = await api(`${SOCIAL}/settings`, { method: "PUT", body: { listed: radio.value === "true" } });
      toast(listed ? "Your Space is now Listed" : "Your Space is now Unlisted");
    } catch (err) {
      reportError(err);
      await loadSettings().catch(() => {});
    }
  });
});

$("form-password").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    await updateSelf(formData(form), "Password updated");
    form.reset();
  });
});

$("btn-delete-account").addEventListener("click", async () => {
  if (!confirm("Delete your account and all of your tasks? This cannot be undone.")) return;
  try {
    await api(`${USERS}/users/${encodeURIComponent(state.user.studentId)}`, { method: "DELETE" });
    logout();
    toast("Your account has been deleted");
  } catch (err) {
    reportError(err);
  }
});

// ---------- admin ----------

async function loadUsers() {
  state.users = await api(`${USERS}/users`);
  const allTasks = await api(`${TASKS}/tasks`);
  for (const u of state.users) {
    const mine = allTasks.filter((t) => t.studentId === u.studentId);
    u.taskCount = mine.length;
    u.doneCount = mine.filter((t) => t.completed).length;
  }
  fillUserSelects();
}

function fillUserSelects() {
  const filter = $("filter-user");
  const previous = filter.value || state.user.studentId;
  const owner = $("form-task").elements.studentId;

  const options = (includeAll) => {
    const opts = [];
    if (includeAll) opts.push(new Option("All users", "__all"));
    for (const u of state.users) {
      const label = u.studentId === state.user.studentId ? `${u.name} (me)` : `${u.name} · ${u.studentId}`;
      opts.push(new Option(label, u.studentId));
    }
    return opts;
  };

  filter.replaceChildren(...options(true));
  filter.value = [...filter.options].some((o) => o.value === previous) ? previous : state.user.studentId;
  owner.replaceChildren(...options(false));
  owner.value = state.user.studentId;
}

function renderUsers() {
  const rows = $("user-rows");
  $("admin-count").textContent = `${state.users.length} users`;

  rows.replaceChildren(...state.users.map((u) => {
    const tr = document.createElement("tr");
    const self = u.studentId === state.user.studentId;

    const nameCell = el("td");
    const name = el("span", null, u.name);
    nameCell.append(name);
    if (!u.hasPassword) nameCell.append(" ", el("span", "pill", "no password"));

    const roleCell = el("td");
    roleCell.append(el("span", `badge ${u.role}`, u.role));

    const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "";
    tr.append(
      nameCell,
      el("td", "mono", u.username ? `@${u.username}` : "—"),
      el("td", "mono", u.studentId),
      roleCell,
      el("td", null, `${u.doneCount}/${u.taskCount} done`),
      el("td", "muted", joined),
    );

    const actions = el("td", "actions");
    const view = el("button", "ghost small", "Tasks");
    view.type = "button";
    view.addEventListener("click", async () => {
      $("filter-user").value = u.studentId;
      showView("tasks");
      await loadTasks().catch(reportError);
    });

    const space = el("button", "ghost small", "Space");
    space.type = "button";
    space.disabled = !u.username;
    space.addEventListener("click", () => openSpace(u.username));

    const rename = el("button", "ghost small", "Rename");
    rename.type = "button";
    rename.addEventListener("click", () => {
      const input = el("input");
      input.value = u.name;
      input.maxLength = 100;
      input.setAttribute("aria-label", "New name");
      const save = el("button", "small", "Save");
      save.type = "button";
      save.addEventListener("click", () => adminUpdate(u, { name: input.value }, "Name updated"));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); if (e.key === "Escape") renderUsers(); });
      nameCell.replaceChildren(input, save);
      input.focus();
    });

    const role = el("button", "ghost small", u.role === "admin" ? "Make user" : "Make admin");
    role.type = "button";
    role.disabled = self;
    role.addEventListener("click", () => adminUpdate(u, { role: u.role === "admin" ? "user" : "admin" }, "Role updated"));

    const del = el("button", "ghost small danger-text", "Delete");
    del.type = "button";
    del.disabled = self;
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${u.name} (${u.studentId}) and all of their tasks?`)) return;
      try {
        await api(`${USERS}/users/${encodeURIComponent(u.studentId)}`, { method: "DELETE" });
        await loadUsers();
        renderUsers();
        toast("User deleted");
      } catch (err) {
        reportError(err);
      }
    });

    const group = el("div", "row-actions");
    group.append(view, space, rename, role, del);
    actions.append(group);
    tr.append(actions);
    return tr;
  }));
}

async function adminUpdate(user, body, message) {
  try {
    await api(`${USERS}/users/${encodeURIComponent(user.studentId)}`, { method: "PUT", body });
    await loadUsers();
    renderUsers();
    toast(message);
  } catch (err) {
    reportError(err);
  }
}

// ---------- social: shared helpers ----------

function personName(person) {
  return person ? person.name : UNLISTED;
}

// "Name @username" (or "User is Unlisted"); clickable when the Space can be opened
function personLink(person) {
  const box = el("span", "person");
  if (!person) {
    box.append(el("span", "unlisted", UNLISTED));
    return box;
  }
  const name = el("button", "link", person.name);
  name.type = "button";
  name.disabled = !person.listed && !isAdmin();
  name.addEventListener("click", () => openSpace(person.username));
  box.append(name, el("span", "muted", `@${person.username}`));
  if (person.studentId) box.append(el("span", "muted", `· ${person.studentId}`));
  if (!person.listed) box.append(el("span", "pill", "unlisted"));
  return box;
}

function renderSharedTask(task, owner) {
  const item = $("tpl-shared-task").content.firstElementChild.cloneNode(true);
  item.classList.toggle("done", task.completed);
  item.classList.toggle("overdue", Boolean(isOverdue(task)));
  item.querySelector(".task-state").textContent = task.completed ? "✓" : "○";
  item.querySelector(".task-title").textContent = task.title;
  fillTaskPills(item, task);

  if (owner !== undefined) {
    const line = item.querySelector(".task-owner");
    line.append(personLink(owner));
    line.hidden = false;
  }
  return item;
}

function button(label, className, onClick) {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick();
    } catch (err) {
      reportError(err);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

// Actions between me and another user; refresh() reloads whatever is on screen
function relationButtons(person, rel, refresh) {
  const u = encodeURIComponent(person.username);
  const buttons = [];

  if (rel.requestReceivedId) {
    buttons.push(button("Accept request", "small", async () => {
      await api(`${SOCIAL}/requests/${rel.requestReceivedId}/accept`, { method: "POST" });
      toast(`${person.name} can now see your Trusted tasks`);
      await refresh();
    }));
    buttons.push(button("Decline", "ghost small", async () => {
      await api(`${SOCIAL}/requests/${rel.requestReceivedId}/decline`, { method: "POST" });
      await refresh();
    }));
  } else if (rel.isMyTaskViewer) {
    buttons.push(button("Remove from my viewers", "ghost small", async () => {
      await api(`${SOCIAL}/viewers/${u}`, { method: "DELETE" });
      toast(`${person.name} can no longer see your Trusted tasks`);
      await refresh();
    }));
  } else {
    buttons.push(button("Add to my viewers", "ghost small", async () => {
      await api(`${SOCIAL}/viewers`, { method: "POST", body: { username: person.username } });
      toast(`${person.name} can now see your Trusted tasks`);
      await refresh();
    }));
  }

  if (!rel.addedMe && person.listed) {
    if (rel.requestSentId) {
      buttons.push(button("Cancel request", "ghost small", async () => {
        await api(`${SOCIAL}/requests/${rel.requestSentId}`, { method: "DELETE" });
        await refresh();
      }));
    } else {
      buttons.push(button("Request access", "small", async () => {
        await api(`${SOCIAL}/requests`, { method: "POST", body: { username: person.username } });
        toast("Viewer Access Request sent");
        await refresh();
      }));
    }
  }
  return buttons;
}

function relationText(rel) {
  const parts = [];
  if (rel.addedMe) parts.push("You can view their Trusted tasks");
  if (rel.isMyTaskViewer) parts.push("They can view your Trusted tasks");
  if (rel.requestSentId) parts.push("Your request is pending");
  if (rel.requestReceivedId) parts.push("They asked to view your Trusted tasks");
  return parts.join(" · ");
}

async function refreshRequestBadge() {
  try {
    const { incoming } = await api(`${SOCIAL}/requests`);
    const badge = $("nav-requests");
    badge.textContent = incoming.length;
    badge.hidden = incoming.length === 0;
  } catch (err) {
    if (!err.sessionExpired) $("nav-requests").hidden = true;
  }
}

// ---------- Discover ----------

async function loadDiscover() {
  const [people, open] = await Promise.all([
    api(`${SOCIAL}/discover`),
    api(`${SOCIAL}/open-tasks`),
  ]);
  state.people = people;
  renderPeople();

  $("open-list").replaceChildren(...open.map((o) => renderSharedTask(o.task, o.owner)));
  $("open-empty").hidden = open.length > 0;
}

function renderPeople() {
  const q = $("discover-search").value.trim().toLowerCase();
  const people = state.people.filter((p) =>
    !q || `${p.person.name} ${p.person.username}`.toLowerCase().includes(q));

  $("discover-count").textContent = `${state.people.length} listed`;
  $("people-list").replaceChildren(...people.map(({ person, relationship }) => {
    const li = el("li", "person-card");
    const info = el("div", "person-info");
    info.append(personLink(person));
    const text = relationText(relationship);
    if (text) info.append(el("div", "hint", text));

    const actions = el("div", "row-actions");
    actions.append(...relationButtons(person, relationship, async () => {
      await loadDiscover();
      refreshRequestBadge();
    }));
    li.append(info, actions);
    return li;
  }));
  $("people-empty").hidden = people.length > 0;
  $("people-empty").textContent = state.people.length === 0 ? "No listed users yet." : "Nobody matches your search.";
}

$("discover-search").addEventListener("input", renderPeople);

// ---------- Space ----------

async function openSpace(username) {
  if (!username) return;
  if (state.view !== "space") state.backView = state.view;
  try {
    state.space = await api(`${SOCIAL}/spaces/${encodeURIComponent(username)}`);
  } catch (err) {
    reportError(err);
    return;
  }
  renderSpace();
  showView("space");
}

function renderSpace() {
  const { person, self, relationship, tasks } = state.space;

  $("space-name").textContent = person.name;
  const meta = [`@${person.username}`, person.listed ? "Listed" : "Unlisted"];
  if (person.studentId) meta.push(person.studentId);
  $("space-meta").textContent = meta.join(" · ");

  const actions = $("space-actions");
  actions.replaceChildren();
  if (self) {
    $("space-relation").textContent = "This is your Space. Others see only what your task visibility allows.";
  } else {
    $("space-relation").textContent = relationText(relationship)
      || "You can see their Open tasks. Request access to see their Trusted tasks too.";
    actions.append(...relationButtons(person, relationship, async () => {
      await openSpace(person.username);
      refreshRequestBadge();
    }));
  }

  $("space-tasks-title").textContent = self ? "Your tasks" : `${person.name}'s tasks`;
  $("space-tasks").replaceChildren(...tasks.map((t) => renderSharedTask(t)));
  $("space-empty").hidden = tasks.length > 0;
}

$("btn-space-back").addEventListener("click", () => openView(state.backView || "discover"));

// ---------- Viewers ----------

async function loadViewers() {
  const [requests, viewers, viewTasks] = await Promise.all([
    api(`${SOCIAL}/requests`),
    api(`${SOCIAL}/viewers`),
    api(`${SOCIAL}/view-tasks`),
  ]);
  const reload = async () => {
    await loadViewers();
  };

  const badge = $("nav-requests");
  badge.textContent = requests.incoming.length;
  badge.hidden = requests.incoming.length === 0;

  $("requests-in").replaceChildren(...requests.incoming.map((r) => {
    const li = el("li", "person-card");
    const info = el("div", "person-info");
    info.append(personLink(r.person), el("div", "hint", `asked ${new Date(r.createdAt).toLocaleDateString()}`));
    const actions = el("div", "row-actions");
    actions.append(
      button("Accept", "small", async () => {
        await api(`${SOCIAL}/requests/${r.id}/accept`, { method: "POST" });
        toast(`${r.person.name} can now see your Trusted tasks`);
        await reload();
      }),
      button("Decline", "ghost small", async () => {
        await api(`${SOCIAL}/requests/${r.id}/decline`, { method: "POST" });
        await reload();
      }),
    );
    li.append(info, actions);
    return li;
  }));
  $("requests-in-empty").hidden = requests.incoming.length > 0;

  $("requests-out").replaceChildren(...requests.outgoing.map((r) => {
    const li = el("li", "person-card");
    const info = el("div", "person-info");
    info.append(personLink(r.person), el("div", "hint", `sent ${new Date(r.createdAt).toLocaleDateString()}`));
    const actions = el("div", "row-actions");
    actions.append(button("Cancel", "ghost small", async () => {
      await api(`${SOCIAL}/requests/${r.id}`, { method: "DELETE" });
      await reload();
    }));
    li.append(info, actions);
    return li;
  }));
  $("requests-out-empty").hidden = requests.outgoing.length > 0;

  $("viewer-list").replaceChildren(...viewers.map((v) => {
    const li = el("li", "person-card");
    const info = el("div", "person-info");
    info.append(personLink(v.person), el("div", "hint", `since ${new Date(v.since).toLocaleDateString()}`));
    const actions = el("div", "row-actions");
    actions.append(button("Remove", "ghost small danger-text", async () => {
      await api(`${SOCIAL}/viewers/${encodeURIComponent(v.person.username)}`, { method: "DELETE" });
      toast(`${v.person.name} removed from your viewers`);
      await reload();
    }));
    li.append(info, actions);
    return li;
  }));
  $("viewer-empty").hidden = viewers.length > 0;

  $("viewtasks-list").replaceChildren(...viewTasks.map((entry) => {
    const group = el("div", "owner-group");
    const head = el("div", "owner-head");
    head.append(personLink(entry.owner), el("span", "hint", `${entry.tasks.length} task${entry.tasks.length === 1 ? "" : "s"}`));
    const list = el("ul", "task-list");
    list.append(...entry.tasks.map((t) => renderSharedTask(t)));
    if (entry.tasks.length === 0) list.append(el("li", "empty small", `${personName(entry.owner)} has no Trusted or Open tasks.`));
    group.append(head, list);
    return group;
  }));
  $("viewtasks-empty").hidden = viewTasks.length > 0;
}

$("form-viewer").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const username = form.elements.username.value.trim().replace(/^@/, "");
    await api(`${SOCIAL}/viewers`, { method: "POST", body: { username } });
    form.reset();
    toast(`@${username} can now see your Trusted tasks`);
    await loadViewers();
  });
});

// ---------- boot ----------

(async function init() {
  const token = store.get("tms.token");
  if (!token) {
    showView("auth");
    return;
  }
  state.token = token;
  try {
    state.user = await api(`${USERS}/auth/me`);
    await startSession(true);
  } catch {
    if (state.token) logout();
  }
})();
