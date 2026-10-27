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

  await loadTasks();
  refreshRequestBadge();

  if (!state.user.username) {
    await openView("account");
    return;
  }
  const last = restore ? store.get("tms.view") : null;
  await openView(["discover", "viewers"].includes(last) || (last === "admin" && isAdmin()) ? last : "tasks");
}

const LOADERS = {
  admin: async () => { await loadUsers(); renderUsers(); },
  discover: () => loadDiscover(),
  viewers: () => loadViewers(),
  account: () => loadSettings(),
};

// Shows a view right away (with what was loaded last time) and refreshes its data in the background
async function openView(name) {
  if (state.token && !state.user.username && name !== "account") {
    toast("Choose a username first", "err");
    name = "account";
  }
  showView(name);
  if (!LOADERS[name]) return;

  const view = $(`view-${name}`);
  view.classList.add("loading");
  try {
    await LOADERS[name]();
  } catch (err) {
    reportError(err);
  } finally {
    view.classList.remove("loading");
  }
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

async function loadTasks() {
  state.tasks = await api(`${TASKS}/tasks`);
  renderTasks();
}

function visibleTasks() {
  const q = $("filter-search").value.trim().toLowerCase();
  const sort = $("filter-sort").value;

  const list = state.tasks.filter((t) => {
    if (state.status === "active" && t.completed) return false;
    if (state.status === "completed" && !t.completed) return false;
    if (state.status === "overdue" && !isOverdue(t)) return false;
    if (q && !`${t.title} ${t.description || ""}`.toLowerCase().includes(q)) return false;
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

  $("btn-clear-done").hidden = !state.tasks.some((t) => t.completed);

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

    await api(`${TASKS}/tasks`, { method: "POST", body });
    form.reset();
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
// Admins see only each account's name and username, and can delete accounts; nothing else

async function loadUsers() {
  state.users = await api(`${USERS}/users`);
}

function renderUsers() {
  $("admin-count").textContent = `${state.users.length} users`;

  $("user-rows").replaceChildren(...state.users.map((u) => {
    const tr = document.createElement("tr");
    const self = u.username !== null && u.username === state.user.username;
    const label = u.username ? `@${u.username}` : "no username";

    const del = el("button", "ghost small danger-text", "Delete");
    del.type = "button";
    del.disabled = self;
    if (self) del.title = "Delete your own account from the Account page";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${u.name} (${label}) and all of their tasks?`)) return;
      try {
        await api(`${USERS}/users/by-id/${encodeURIComponent(u.id)}`, { method: "DELETE" });
        await loadUsers();
        renderUsers();
        toast("User deleted");
      } catch (err) {
        reportError(err);
      }
    });

    const actions = el("td", "actions");
    const group = el("div", "row-actions");
    group.append(del);
    actions.append(group);

    tr.append(
      el("td", null, self ? `${u.name} (me)` : u.name),
      el("td", u.username ? "mono" : "muted", u.username ? `@${u.username}` : "—"),
      actions,
    );
    return tr;
  }));
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
  name.disabled = !person.listed;
  name.addEventListener("click", () => openSpace(person.username));
  box.append(name, el("span", "muted", `@${person.username}`));
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

function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
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

  $("open-count").textContent = plural(open.length, "task");
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
  $("space-meta").textContent = `@${person.username} · ${person.listed ? "Listed" : "Unlisted"}`;

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

  $("requests-count").textContent = `${requests.incoming.length} received · ${requests.outgoing.length} sent`;
  $("requests-in-count").textContent = requests.incoming.length;
  $("requests-out-count").textContent = requests.outgoing.length;
  $("viewers-count").textContent = plural(viewers.length, "person", "people");
  $("viewtasks-count").textContent = plural(viewTasks.length, "person", "people");

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

  // one dropdown per person; the ones already open stay open after a refresh
  const opened = new Set([...$("viewtasks-list").querySelectorAll("details[open]")].map((d) => d.dataset.key));
  $("viewtasks-list").replaceChildren(...viewTasks.map((entry, i) => {
    const group = el("details", "fold sub owner-group");
    group.dataset.key = entry.owner?.username ?? `unlisted-${i}`;
    group.open = opened.has(group.dataset.key);
    const head = el("summary");
    head.append(personLink(entry.owner), el("span", "hint", plural(entry.tasks.length, "task")));
    const list = el("ul", "task-list");
    list.append(...entry.tasks.map((t) => renderSharedTask(t)));
    if (entry.tasks.length === 0) list.append(el("li", "empty small", `${personName(entry.owner)} has no Trusted or Open tasks.`));
    const body = el("div", "fold-body");
    body.append(list);
    group.append(head, body);
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
