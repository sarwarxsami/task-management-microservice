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
  audiences: new Map(), // taskId -> audience of my Hand-picked / Group tasks
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

  refreshRequestBadge();

  if (!state.user.username) {
    await openView("account");
    return;
  }
  const last = restore ? store.get("tms.view") : null;
  await openView(["discover", "viewers"].includes(last) || (last === "admin" && isAdmin()) ? last : "tasks");
}

const LOADERS = {
  // reloaded on every visit, so changes made on other pages (e.g. a deleted group) show up
  tasks: () => loadTasks(),
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
  const [tasks, audiences] = await Promise.all([
    api(`${TASKS}/tasks`),
    // tasks still show if social-service is down; they just lose the Hand-picked label
    api(`${SOCIAL}/audiences`).catch((err) => {
      if (err.sessionExpired) throw err;
      return [];
    }),
  ]);
  state.tasks = tasks;
  state.audiences = new Map(audiences.map((a) => [a.taskId, a]));
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

  fillTaskPills(item, task, state.audiences.get(task.id));

  const who = item.querySelector('[data-action="who"]');
  who.hidden = task.visibility !== "trusted";
  who.addEventListener("click", () => showWhoCanSee(task));
  item.querySelector('[data-action="edit"]').addEventListener("click", () => {
    item.replaceWith(renderEditor(task));
  });
  item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteTask(task));
  return item;
}

// Priority, visibility, due date and description, shared by own and others' tasks.
// audience: set when it is one of my Hand-picked / Group tasks
function fillTaskPills(item, task, audience) {
  const priority = item.querySelector(".priority");
  priority.textContent = task.priority;
  priority.classList.add(task.priority);

  const visibility = item.querySelector(".visibility");
  visibility.textContent = VISIBILITY_LABEL[task.visibility] || task.visibility;
  visibility.classList.add(`vis-${task.visibility}`);
  if (task.visibility === "trusted" && audience?.mode === "picked") {
    visibility.textContent = `Hand-picked · ${audience.people.length}`;
    visibility.title = audience.people.map((p) => `@${p.username}`).join(", ") || "Nobody picked is still on Your Task Viewers";
  } else if (task.visibility === "trusted" && audience?.mode === "groups") {
    const n = audience.groups.length + (audience.includeDefault ? 1 : 0);
    visibility.textContent = `Groups · ${n}`;
    visibility.title = groupNames(audience) || "None of the chosen groups exist any more";
  }

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
  setupAudience(form, state.audiences.get(task.id));

  item.querySelector('[data-action="cancel"]').addEventListener("click", renderTasks);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(form, async () => {
      await saveTask(task, taskBody(form), form.audience);
      await loadTasks();
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
    await saveTask(null, taskBody(form), form.audience);
    form.reset();
    form.resetAudience();
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

// ---------- Trusted audience: All Trusted / Hand-picked / Group ----------

function taskBody(form) {
  const data = formData(form);
  return {
    title: data.title,
    description: data.description,
    deadline: data.deadline || null,
    priority: data.priority,
    visibility: data.visibility,
  };
}

// What social-service stores for a Hand-picked or Group audience
function audienceBody(audience) {
  if (audience.mode === "picked") {
    return { mode: "picked", usernames: audience.people.map((p) => p.username) };
  }
  return { mode: "groups", groupIds: audience.groups.map((g) => g.id), includeDefault: audience.includeDefault };
}

// Creates (task = null) or updates a task together with its audience.
// A new Hand-picked / Group task is created as Only Me and opened up only after its audience is stored,
// so it is never visible to all trusted viewers, not even for a moment.
async function saveTask(task, body, audience) {
  const limited = body.visibility === "trusted" && audience.mode !== "all";
  const setAudience = (id) => api(`${SOCIAL}/tasks/${id}/audience`, { method: "PUT", body: audienceBody(audience) });

  if (!task) {
    if (!limited) return api(`${TASKS}/tasks`, { method: "POST", body });
    const created = await api(`${TASKS}/tasks`, { method: "POST", body: { ...body, visibility: "only_me" } });
    await setAudience(created.id);
    return api(`${TASKS}/tasks/${created.id}`, { method: "PUT", body });
  }

  if (limited) {
    await setAudience(task.id);
    return api(`${TASKS}/tasks/${task.id}`, { method: "PUT", body });
  }
  const updated = await api(`${TASKS}/tasks/${task.id}`, { method: "PUT", body });
  if (state.audiences.has(task.id)) {
    await api(`${SOCIAL}/tasks/${task.id}/audience`, { method: "DELETE" });
  }
  return updated;
}

const ALL_TRUSTED = { mode: "all", people: [], groups: [], includeDefault: false };

// "Study, Default"
function groupNames(audience) {
  return [...audience.groups.map((g) => g.name), ...(audience.includeDefault ? ["Default"] : [])].join(", ");
}

// Wires the audience row of a task form; form.audience is ALL_TRUSTED or an audience from GET /audiences
function setupAudience(form, initial = ALL_TRUSTED) {
  const box = form.querySelector(".audience");
  const visibility = form.elements.visibility;
  form.audience = initial;

  const render = () => {
    box.hidden = visibility.value !== "trusted";
    box.querySelectorAll("[data-audience]").forEach((b) => {
      b.classList.toggle("active", b.dataset.audience === form.audience.mode);
    });

    const summary = box.querySelector(".audience-summary");
    const { mode, people } = form.audience;
    summary.hidden = mode === "all";
    summary.replaceChildren();
    if (mode === "all") return;

    const change = el("button", "link", "Change");
    change.type = "button";
    change.addEventListener("click", mode === "picked" ? pickPeople : pickGroups);
    if (mode === "picked") {
      const names = people.map((p) => `@${p.username}`).join(", ");
      summary.append(`${plural(people.length, "person", "people")}${names ? `: ${names}` : ""} · `, change);
    } else {
      summary.append(`Groups: ${groupNames(form.audience) || "none left"} · `, change);
    }
  };

  const pickPeople = async () => {
    const people = await pickViewers(form.audience.mode === "picked" ? form.audience.people : []);
    if (people) form.audience = { ...ALL_TRUSTED, mode: "picked", people };
    render();
  };

  const pickGroups = async () => {
    const chosen = await pickTaskGroups(form.audience.mode === "groups" ? form.audience : ALL_TRUSTED);
    if (chosen) form.audience = { ...ALL_TRUSTED, mode: "groups", ...chosen };
    render();
  };

  visibility.addEventListener("change", render);
  box.querySelector('[data-audience="all"]').addEventListener("click", () => {
    form.audience = ALL_TRUSTED;
    render();
  });
  box.querySelector('[data-audience="picked"]').addEventListener("click", pickPeople);
  box.querySelector('[data-audience="groups"]').addEventListener("click", pickGroups);
  form.resetAudience = () => {
    form.audience = ALL_TRUSTED;
    render();
  };
  render();
}

setupAudience($("form-task"));

// Searchable checkbox list in a pop-up. items: [{ key, label, sub }].
// Resolves to the ticked keys (in list order), or null when cancelled.
function pickFromList({ title, hint, items, selected = [], emptyText }) {
  const dialog = $("picker");
  const search = $("picker-search");
  const chosen = new Set(selected);
  $("picker-title").textContent = title;
  $("picker-hint").textContent = hint;

  const count = () => {
    $("picker-count").textContent = `${chosen.size} selected`;
    $("picker-done").disabled = chosen.size === 0;
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(/^@/, "");
    const shown = items.filter((item) => !q || `${item.label} ${item.sub}`.toLowerCase().includes(q));
    $("picker-list").replaceChildren(...shown.map((item) => {
      const box = el("input");
      box.type = "checkbox";
      box.checked = chosen.has(item.key);
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(item.key);
        else chosen.delete(item.key);
        count();
      });
      const label = el("label", "pick");
      label.append(box, el("span", "pick-name", item.label), el("span", "muted", item.sub));
      const li = el("li");
      li.append(label);
      return li;
    }));
    const empty = $("picker-empty");
    empty.hidden = shown.length > 0;
    empty.textContent = items.length === 0 ? emptyText : "Nothing matches your search.";
  };

  search.value = "";
  search.oninput = draw;
  draw();
  count();
  dialog.showModal();
  search.focus();

  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.close();
      resolve(result);
    };
    $("picker-done").onclick = () => finish(items.filter((item) => chosen.has(item.key)).map((item) => item.key));
    $("picker-cancel").onclick = () => finish(null);
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(null);
    };
  });
}

// Hand-picked: people from Your Task Viewers; resolves to [{ username, name }] or null
async function pickViewers(selected) {
  let viewers;
  try {
    viewers = (await api(`${SOCIAL}/viewers`)).map((v) => v.person);
  } catch (err) {
    reportError(err);
    return null;
  }
  const keys = await pickFromList({
    title: "Hand-pick viewers",
    hint: "Only the people you tick can see this task. Everyone here is on Your Task Viewers.",
    items: viewers.map((p) => ({ key: p.username, label: p.name, sub: `@${p.username}` })),
    selected: selected.map((p) => p.username),
    emptyText: "Your Task Viewers list is empty. Add people on the Viewers page first.",
  });
  return keys && viewers.filter((p) => keys.includes(p.username)).map((p) => ({ username: p.username, name: p.name }));
}

// Group: several groups, Default included; resolves to { groups: [{ id, name }], includeDefault } or null
async function pickTaskGroups(current) {
  let data;
  try {
    data = await api(`${SOCIAL}/groups`);
  } catch (err) {
    reportError(err);
    return null;
  }
  const items = [
    ...data.groups.map((g) => ({ key: `g${g.id}`, label: g.name, sub: plural(g.members.length, "member") })),
    { key: "default", label: "Default", sub: `${plural(data.defaultMembers.length, "person", "people")} in no group` },
  ];
  const keys = await pickFromList({
    title: "Share with groups",
    hint: "Everyone in a ticked group can see this task. Create and fill groups under Your Task Viewers on the Viewers page.",
    items,
    selected: [...current.groups.map((g) => `g${g.id}`), ...(current.includeDefault ? ["default"] : [])],
    emptyText: "",
  });
  if (!keys) return null;
  return {
    groups: data.groups.filter((g) => keys.includes(`g${g.id}`)).map((g) => ({ id: g.id, name: g.name })),
    includeDefault: keys.includes("default"),
  };
}

// Read-only pop-up: the groups and people who can see one of my Trusted tasks
async function showWhoCanSee(task) {
  let who;
  try {
    who = await api(`${SOCIAL}/tasks/${task.id}/who-can-see`);
  } catch (err) {
    reportError(err);
    return;
  }

  const summary = {
    all: "All Trusted: everyone on Your Task Viewers.",
    picked: "Hand-picked: only these people.",
    groups: "Group: everyone in these groups.",
  }[who.mode];
  $("who-title").textContent = task.title;
  $("who-summary").textContent = summary;

  $("who-groups").replaceChildren(...who.groups.map((g) => {
    const group = el("details", "fold sub");
    const head = el("summary");
    head.append(el("h3", null, g.name), el("span", "hint", plural(g.members.length, "member")));
    const list = el("ul", "people compact");
    list.append(...g.members.map((p) => personRow(p)));
    const body = el("div", "fold-body");
    body.append(g.members.length ? list : el("p", "empty small", "Nobody in this group yet."));
    group.append(head, body);
    return group;
  }));

  $("who-people").replaceChildren(...who.people.map((w) => personRow(w.person, w.inDefault ? "Default group" : null)));
  $("who-empty").hidden = who.groups.length > 0 || who.people.length > 0;

  const dialog = $("who");
  dialog.showModal();
  $("who-close").onclick = () => dialog.close();
}

// A person line; note is an optional side note such as "Default group"
function personRow(person, note) {
  const li = el("li", "person-card");
  const info = el("div", "person-info");
  info.append(personLink(person));
  li.append(info);
  if (note) li.append(el("span", "pill", note));
  return li;
}

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
  const [requests, viewers, viewTasks, groups] = await Promise.all([
    api(`${SOCIAL}/requests`),
    api(`${SOCIAL}/viewers`),
    api(`${SOCIAL}/view-tasks`),
    api(`${SOCIAL}/groups`),
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
  $("viewers-count").textContent = `${plural(viewers.length, "person", "people")} · ${plural(groups.groups.length, "group")}`;
  $("all-viewers-count").textContent = viewers.length;
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

  renderGroups(groups, viewers.map((v) => v.person), reload);

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

// Groups inside Your Task Viewers, then Default (viewers in no group); open dropdowns stay open after a refresh
function renderGroups({ groups, defaultMembers }, viewers, reload) {
  const list = $("group-list");
  const opened = new Set([...list.querySelectorAll("details[open]")].map((d) => d.dataset.key));

  const dropdown = (key, name, count, body) => {
    const box = el("details", "fold sub");
    box.dataset.key = key;
    box.open = opened.has(key);
    const head = el("summary");
    head.append(el("h3", null, name), el("span", "hint", count));
    box.append(head, body);
    return box;
  };

  const members = (people, removeFrom) => {
    if (people.length === 0) return el("p", "empty small", "Nobody in this group yet.");
    const ul = el("ul", "people compact");
    ul.append(...people.map((p) => {
      const li = personRow(p);
      if (removeFrom) {
        const actions = el("div", "row-actions");
        actions.append(button("Remove", "ghost small", async () => {
          await api(`${SOCIAL}/groups/${removeFrom.id}/members/${encodeURIComponent(p.username)}`, { method: "DELETE" });
          toast(`${p.name} removed from ${removeFrom.name}`);
          await reload();
        }));
        li.append(actions);
      }
      return li;
    }));
    return ul;
  };

  list.replaceChildren(
    ...groups.map((g) => {
      const body = el("div", "fold-body");
      const actions = el("div", "row-actions start");

      const add = button("Add member", "small", async () => {
        const inGroup = new Set(g.members.map((m) => m.username));
        const candidates = viewers.filter((p) => !inGroup.has(p.username));
        const keys = await pickFromList({
          title: `Add to ${g.name}`,
          hint: "Your task viewers who are not in this group yet. Someone can be in several groups.",
          items: candidates.map((p) => ({ key: p.username, label: p.name, sub: `@${p.username}` })),
          emptyText: viewers.length === 0
            ? "Your Task Viewers list is empty. Add people above first."
            : "Everyone on Your Task Viewers is already in this group.",
        });
        if (!keys) return;
        await api(`${SOCIAL}/groups/${g.id}/members`, { method: "POST", body: { usernames: keys } });
        toast(`Added ${plural(keys.length, "person", "people")} to ${g.name}`);
        await reload();
      });

      const rename = button("Rename", "ghost small", async () => {
        const form = el("form", "row");
        const input = el("input");
        input.name = "name";
        input.value = g.name;
        input.maxLength = 30;
        input.required = true;
        input.setAttribute("aria-label", "Group name");
        const save = el("button", "small", "Save");
        save.type = "submit";
        const cancel = el("button", "ghost small", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => form.replaceWith(actions));
        form.append(input, save, cancel);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          withBusy(form, async () => {
            await api(`${SOCIAL}/groups/${g.id}`, { method: "PUT", body: { name: input.value } });
            toast("Group renamed");
            await reload();
          });
        });
        actions.replaceWith(form);
        input.focus();
      });

      const del = button("Delete", "ghost small danger-text", async () => {
        if (!confirm(`Delete the group "${g.name}"? Its members stay on Your Task Viewers. Tasks shared only with this group will be visible to nobody.`)) return;
        await api(`${SOCIAL}/groups/${g.id}`, { method: "DELETE" });
        toast(`Group ${g.name} deleted`);
        await reload();
      });

      actions.append(add, rename, del);
      body.append(members(g.members, g), actions);
      return dropdown(`g${g.id}`, g.name, plural(g.members.length, "member"), body);
    }),
    (() => {
      const body = el("div", "fold-body");
      body.append(el("p", "hint", "Your task viewers who are in no group."), members(defaultMembers, null));
      return dropdown("default", "Default", plural(defaultMembers.length, "member"), body);
    })(),
  );
}

$("form-new-group").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  withBusy(form, async () => {
    const group = await api(`${SOCIAL}/groups`, { method: "POST", body: { name: form.elements.name.value } });
    form.reset();
    toast(`Group ${group.name} created`);
    await loadViewers();
    // show the new group straight away so members can be added
    const created = $("group-list").querySelector(`[data-key="g${group.id}"]`);
    if (created) created.open = true;
  });
});

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
