// Integration tests: need a Postgres with db/init.sql applied (DB_* env vars)
process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.INTERNAL_API_KEY ??= "test-internal-key-that-is-at-least-32-chars";
process.env.ADMIN_STUDENT_IDS = "t-admin";

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/models/db');
const mailer = require('../src/mailer');

const BASE = "/service/user-service";
const PASSWORD = "password123";
const HASH = bcrypt.hashSync(PASSWORD, 4);

// codes that would have been emailed, by address
const sent = new Map();
mailer.configured = () => true;
mailer.sendCode = async (to, code) => { sent.set(to, code); };

// each test gets its own client address, so rate limits do not carry over between tests
let clientNumber = 0;
let client;
const post = (path) => request(app).post(`${BASE}${path}`).set("X-Forwarded-For", client);

async function cleanup() {
    await pool.query("DELETE FROM users WHERE student_id LIKE 't-%' OR email LIKE 't.%@gmail.com'");
    await pool.query("DELETE FROM pending_registrations WHERE email LIKE 't.%@gmail.com'");
}

// An account straight in the database, as an old account without email has it
async function makeUser(key, { email = null } = {}) {
    await pool.query(
        "INSERT INTO users (name, student_id, username, email, password_hash) VALUES ($1, $2, $3, $4, $5)",
        [key, `t-${key}`, `t_${key}`, email, HASH]
    );
    const res = await post("/auth/login").send({ login: `t_${key}`, password: PASSWORD });
    return res.body.token;
}

const auth = (req, token) => req.set("Authorization", `Bearer ${token}`);
const details = (key, more = {}) => ({ name: key, email: `t.${key}@gmail.com`, username: `t_${key}`, password: PASSWORD, ...more });

before(cleanup);
beforeEach(async () => {
    await cleanup();
    sent.clear();
    client = `10.0.0.${++clientNumber}`;
});
after(async () => {
    await cleanup();
    await pool.end();
});

test("health check", async () => {
    const res = await request(app).get(`${BASE}/health`);
    assert.equal(res.status, 200);
});

test("register with a Gmail code, then log in with username or email", async () => {
    const start = await post("/auth/register").send(details("alice", { name: "Alice", email: " T.Alice@Gmail.com " }));
    assert.equal(start.status, 202);
    assert.equal(start.body.token, undefined);

    // no account until the code is entered
    assert.equal((await post("/auth/login").send({ login: "t_alice", password: PASSWORD })).status, 401);

    const email = "t.alice@gmail.com";
    const verify = await post("/auth/register/verify").send({ email, code: sent.get(email) });
    assert.equal(verify.status, 201);
    assert.ok(verify.body.token);
    assert.equal(verify.body.user.email, email);
    assert.equal(verify.body.user.username, "t_alice");
    assert.equal(verify.body.user.role, "user");
    assert.deepEqual(verify.body.user.toursDone, []);
    assert.match(verify.body.user.studentId, /^u-/);

    for (const login of ["t_alice", "T_ALICE", email, " T.Alice@gmail.com "]) {
        assert.equal((await post("/auth/login").send({ login, password: PASSWORD })).status, 200, login);
    }
    assert.equal((await post("/auth/login").send({ login: email, password: "wrong-password" })).status, 401);

    const me = await auth(request(app).get(`${BASE}/auth/me`), verify.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, email);

    // the code is used up
    assert.equal((await post("/auth/register/verify").send({ email, code: sent.get(email) })).status, 400);
});

test("student IDs no longer log anyone in", async () => {
    await makeUser("old");
    assert.equal((await post("/auth/login").send({ login: "t-old", password: PASSWORD })).status, 401);
    assert.equal((await post("/auth/login").send({ studentId: "t-old", password: PASSWORD })).status, 400);
});

test("register validates input and allows only Gmail", async () => {
    for (const bad of [
        details("bob", { email: "t.bob@yahoo.com" }),
        details("bob", { email: "t.bob@gmail.com.evil.com" }),
        details("bob", { email: "not-an-email" }),
        details("bob", { password: "short" }),
        details("bob", { username: "no spaces!" }),
        details("bob", { name: " " }),
    ]) {
        assert.equal((await post("/auth/register").send(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal(sent.size, 0);
});

test("email and username must be free", async () => {
    await makeUser("taken", { email: "t.taken@gmail.com" });
    const sameEmail = await post("/auth/register").send(details("bob", { email: "t.taken@gmail.com" }));
    assert.equal(sameEmail.status, 409);
    assert.equal(sameEmail.body.error, "Email is already registered");
    const sameName = await post("/auth/register").send(details("bob", { username: "T_TAKEN" }));
    assert.equal(sameName.status, 409);
    assert.equal(sameName.body.error, "Username is already taken");
});

test("a username taken while waiting for the code is refused at the end", async () => {
    await post("/auth/register").send(details("bob"));
    await makeUser("bob");
    const res = await post("/auth/register/verify").send({ email: "t.bob@gmail.com", code: sent.get("t.bob@gmail.com") });
    assert.equal(res.status, 409);
});

test("wrong codes are limited to five attempts", async () => {
    const email = "t.bob@gmail.com";
    await post("/auth/register").send(details("bob"));
    const code = sent.get(email);
    const wrong = code === "111111" ? "222222" : "111111";

    for (let i = 0; i < 5; i++) {
        const res = await post("/auth/register/verify").send({ email, code: wrong });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "Wrong code");
    }
    // even the right code is refused now
    const res = await post("/auth/register/verify").send({ email, code });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /expired/);
});

test("expired codes are refused", async () => {
    const email = "t.bob@gmail.com";
    await post("/auth/register").send(details("bob"));
    await pool.query("UPDATE pending_registrations SET expires_at = now() - interval '1 second' WHERE email = $1", [email]);
    assert.equal((await post("/auth/register/verify").send({ email, code: sent.get(email) })).status, 400);
});

test("a new code needs a minute's wait and replaces the old one", async () => {
    const email = "t.bob@gmail.com";
    await post("/auth/register").send(details("bob"));
    const first = sent.get(email);
    assert.equal((await post("/auth/register").send(details("bob"))).status, 429);

    await pool.query("UPDATE pending_registrations SET sent_at = now() - interval '2 minutes' WHERE email = $1", [email]);
    assert.equal((await post("/auth/register").send(details("bob"))).status, 202);
    const second = sent.get(email);
    if (first !== second) {
        assert.equal((await post("/auth/register/verify").send({ email, code: first })).status, 400);
    }
    assert.equal((await post("/auth/register/verify").send({ email, code: second })).status, 201);
});

test("codes are stored hashed", async () => {
    const email = "t.bob@gmail.com";
    await post("/auth/register").send(details("bob"));
    const row = await pool.query("SELECT code_hash, password_hash FROM pending_registrations WHERE email = $1", [email]);
    assert.notEqual(row.rows[0].code_hash, sent.get(email));
    assert.notEqual(row.rows[0].password_hash, PASSWORD);
});

test("asking for codes is rate limited per client", async () => {
    let last;
    for (let i = 0; i < 31; i++) {
        last = await post("/auth/register").send(details("rate", { email: `t.rate${i}@gmail.com`, username: `t_rate${i}` }));
    }
    assert.equal(last.status, 429);
});

test("sending problems are reported and leave nothing behind", async () => {
    const { sendCode, configured } = mailer;
    try {
        mailer.sendCode = async () => { throw new Error("smtp down"); };
        assert.equal((await post("/auth/register").send(details("bob"))).status, 502);
        const left = await pool.query("SELECT 1 FROM pending_registrations WHERE email = 't.bob@gmail.com'");
        assert.equal(left.rows.length, 0);

        mailer.configured = () => false;
        assert.equal((await post("/auth/register").send(details("bob"))).status, 503);
    } finally {
        mailer.sendCode = sendCode;
        mailer.configured = configured;
    }
});

test("an old account adds its email with a code", async () => {
    const old = await makeUser("old");
    const url = "/users/t-old/email";
    const email = "t.old@gmail.com";

    const me = await auth(request(app).get(`${BASE}/auth/me`), old);
    assert.equal(me.body.email, null);

    assert.equal((await auth(post(url), old).send({ email: "t.old@yahoo.com" })).status, 400);
    assert.equal((await auth(post(url), old).send({ email })).status, 202);
    assert.equal((await auth(post(`${url}/verify`), old).send({ code: "000000" })).status, 400);
    const ok = await auth(post(`${url}/verify`), old).send({ code: sent.get(email) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, email);

    assert.equal((await post("/auth/login").send({ login: email, password: PASSWORD })).status, 200);

    // someone else cannot change it or take the address
    const other = await makeUser("other");
    assert.equal((await auth(post(url), other).send({ email: "t.x@gmail.com" })).status, 403);
    assert.equal((await auth(post("/users/t-other/email"), other).send({ email })).status, 409);
});

test("authorization on user routes", async () => {
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const admin = await makeUser("admin");
    const put = (id, token) => auth(request(app).put(`${BASE}/users/${id}`), token);
    const del = (path, token) => auth(request(app).delete(`${BASE}/users/${path}`), token);

    assert.equal((await request(app).get(`${BASE}/users`)).status, 401);
    assert.equal((await auth(request(app).get(`${BASE}/users`), alice)).status, 403);

    // admins see only id, name and username
    const list = await auth(request(app).get(`${BASE}/users`), admin);
    assert.equal(list.status, 200);
    const bobRow = list.body.find(u => u.username === "t_bob");
    assert.deepEqual(Object.keys(bobRow).sort(), ["id", "name", "username"]);
    assert.ok(list.body.every(u => Object.keys(u).length === 3));

    assert.equal((await put("t-bob", alice).send({ name: "Hacked" })).status, 403);
    assert.equal((await put("t-alice", alice).send({ role: "admin" })).status, 403);

    // admins cannot rename, change or delete other users through the owner routes
    assert.equal((await put("t-bob", admin).send({ name: "Robert" })).status, 403);
    assert.equal((await put("t-bob", admin).send({ role: "admin" })).status, 403);
    assert.equal((await del("t-bob", admin)).status, 403);

    // owner renames and changes password
    const rename = await put("t-alice", alice).send({ name: "Alice B", currentPassword: PASSWORD, newPassword: "newpassword1" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.name, "Alice B");
    assert.equal((await post("/auth/login").send({ login: "t_alice", password: "newpassword1" })).status, 200);

    // owner deletes own account
    assert.equal((await del("t-alice", bob)).status, 403);
    assert.equal((await del("t-alice", alice)).status, 204);

    // only admins delete by id
    assert.equal((await del(`by-id/${bobRow.id}`, bob)).status, 403);
    assert.equal((await del("by-id/abc", admin)).status, 400);
    assert.equal((await del(`by-id/${bobRow.id}`, admin)).status, 204);
    assert.equal((await del(`by-id/${bobRow.id}`, admin)).status, 404);
});

test("admin rights follow ADMIN_STUDENT_IDS, not the token", async () => {
    const { ADMIN_STUDENT_IDS } = require('../src/config');
    const admin = await makeUser("admin");
    const list = () => auth(request(app).get(`${BASE}/users`), admin);
    assert.equal((await list()).status, 200);

    // removed from the list: the same token stops working and the stored role is demoted
    ADMIN_STUDENT_IDS.splice(ADMIN_STUDENT_IDS.indexOf("t-admin"), 1);
    try {
        assert.equal((await list()).status, 403);
        const me = await auth(request(app).get(`${BASE}/auth/me`), admin);
        assert.equal(me.body.role, "user");
        const row = await pool.query("SELECT role FROM users WHERE student_id = 't-admin'");
        assert.equal(row.rows[0].role, "user");
    } finally {
        ADMIN_STUDENT_IDS.push("t-admin");
    }

    // a deleted admin's token is rejected
    await pool.query("DELETE FROM users WHERE student_id = 't-admin'");
    assert.equal((await list()).status, 401);
});

test("page tours are remembered per account and page", async () => {
    const bob = await makeUser("bob");
    const admin = await makeUser("admin");
    const mark = (page, token) => auth(request(app).put(`${BASE}/users/t-bob/tours/${page}`), token);

    // only the owner, and only known pages
    assert.equal((await mark("tasks", admin)).status, 403);
    assert.equal((await mark("nowhere", bob)).status, 400);

    assert.deepEqual((await mark("tasks", bob)).body.toursDone, ["tasks"]);
    assert.deepEqual((await mark("discover", bob)).body.toursDone, ["tasks", "discover"]);
    // marking twice changes nothing
    assert.deepEqual((await mark("tasks", bob)).body.toursDone, ["tasks", "discover"]);

    const login = await post("/auth/login").send({ login: "t_bob", password: PASSWORD });
    assert.deepEqual(login.body.user.toursDone, ["tasks", "discover"]);
});

test("rejects tampered tokens", async () => {
    const res = await request(app).get(`${BASE}/auth/me`).set("Authorization", "Bearer abc.def.ghi");
    assert.equal(res.status, 401);
});

test("usernames can be changed, are lowercased and stay unique", async () => {
    const bob = await makeUser("bob");
    await makeUser("admin");
    const put = (username) => auth(request(app).put(`${BASE}/users/t-bob`), bob).send({ username });

    assert.equal((await put("no spaces!")).status, 400);
    assert.equal((await put("T_ADMIN")).status, 409);
    const rename = await put("Bobby");
    assert.equal(rename.status, 200);
    assert.equal(rename.body.username, "bobby");
});

test("internal user lookup requires the internal key", async () => {
    await makeUser("bob");
    await makeUser("admin");

    assert.equal((await request(app).get("/internal/users?ids=t-bob")).status, 401);
    assert.equal((await request(app).get("/internal/users?ids=t-bob").set("X-Internal-Key", "wrong")).status, 401);

    const res = await request(app).get("/internal/users?ids=t-bob&usernames=T_ADMIN")
        .set("X-Internal-Key", process.env.INTERNAL_API_KEY);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(u => u.username).sort(), ["t_admin", "t_bob"]);
    assert.ok(res.body.every(u => !("password_hash" in u) && !("email" in u)));
});
