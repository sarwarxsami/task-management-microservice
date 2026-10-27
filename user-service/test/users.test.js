// Integration tests: need a Postgres with db/init.sql applied (DB_* env vars)
process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.INTERNAL_API_KEY ??= "test-internal-key-that-is-at-least-32-chars";
process.env.ADMIN_STUDENT_IDS = "t-admin";

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/models/db');

const BASE = "/service/user-service";
const IDS = ["t-alice", "t-bob", "t-admin", "t-legacy"];

async function cleanup() {
    await pool.query("DELETE FROM users WHERE student_id = ANY($1)", [IDS]);
}

function register(studentId, name = studentId, password = "password123", username = studentId.replace("-", "_")) {
    return request(app).post(`${BASE}/auth/register`).send({ name, studentId, password, username });
}

before(cleanup);
after(async () => {
    await cleanup();
    await pool.end();
});

test("health check", async () => {
    const res = await request(app).get(`${BASE}/health`);
    assert.equal(res.status, 200);
});

test("register, login and me", async () => {
    const reg = await register("t-alice", "Alice");
    assert.equal(reg.status, 201);
    assert.ok(reg.body.token);
    assert.deepEqual(reg.body.user, { name: "Alice", studentId: "t-alice", username: "t_alice", role: "user" });

    const dup = await register("t-alice");
    assert.equal(dup.status, 409);

    const bad = await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-alice", password: "wrong-password" });
    assert.equal(bad.status, 401);

    const login = await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-alice", password: "password123" });
    assert.equal(login.status, 200);

    const me = await request(app).get(`${BASE}/auth/me`).set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.name, "Alice");
});

test("register validates input", async () => {
    const res = await request(app).post(`${BASE}/auth/register`).send({ name: "X", studentId: "t-bob", password: "short" });
    assert.equal(res.status, 400);
});

test("legacy account without password can be claimed once", async () => {
    await pool.query("INSERT INTO users (name, student_id) VALUES ('Old', 't-legacy')");
    const claim = await register("t-legacy", "Claimed");
    assert.equal(claim.status, 201);
    assert.equal(claim.body.user.name, "Claimed");
    const again = await register("t-legacy", "Hijack");
    assert.equal(again.status, 409);
});

test("authorization on user routes", async () => {
    const alice = (await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-alice", password: "password123" })).body.token;
    const bob = (await register("t-bob", "Bob")).body.token;
    const admin = (await register("t-admin", "Admin")).body;
    assert.equal(admin.user.role, "admin");

    assert.equal((await request(app).get(`${BASE}/users`)).status, 401);
    assert.equal((await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${alice}`)).status, 403);

    // admins see only id, name and username
    const list = await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${admin.token}`);
    assert.equal(list.status, 200);
    const bobRow = list.body.find(u => u.username === "t_bob");
    assert.deepEqual(Object.keys(bobRow).sort(), ["id", "name", "username"]);
    assert.ok(list.body.every(u => Object.keys(u).length === 3));

    // a user cannot edit someone else
    const edit = await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${alice}`).send({ name: "Hacked" });
    assert.equal(edit.status, 403);

    // nobody can change roles, not even their own
    const promote = await request(app).put(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`).send({ role: "admin" });
    assert.equal(promote.status, 403);

    // admins cannot rename, change or delete other users through the owner routes
    assert.equal((await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`).send({ name: "Robert" })).status, 403);
    assert.equal((await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`).send({ role: "admin" })).status, 403);
    assert.equal((await request(app).delete(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`)).status, 403);

    // owner renames and changes password
    const rename = await request(app).put(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`)
        .send({ name: "Alice B", currentPassword: "password123", newPassword: "newpassword1" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.name, "Alice B");
    const relogin = await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-alice", password: "newpassword1" });
    assert.equal(relogin.status, 200);

    // owner deletes own account
    assert.equal((await request(app).delete(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${bob}`)).status, 403);
    assert.equal((await request(app).delete(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`)).status, 204);

    // only admins delete by id
    assert.equal((await request(app).delete(`${BASE}/users/by-id/${bobRow.id}`).set("Authorization", `Bearer ${bob}`)).status, 403);
    assert.equal((await request(app).delete(`${BASE}/users/by-id/abc`).set("Authorization", `Bearer ${admin.token}`)).status, 400);
    assert.equal((await request(app).delete(`${BASE}/users/by-id/${bobRow.id}`).set("Authorization", `Bearer ${admin.token}`)).status, 204);
    assert.equal((await request(app).delete(`${BASE}/users/by-id/${bobRow.id}`).set("Authorization", `Bearer ${admin.token}`)).status, 404);
});

test("admin rights follow ADMIN_STUDENT_IDS, not the token", async () => {
    const { ADMIN_STUDENT_IDS } = require('../src/config');
    const admin = (await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-admin", password: "password123" })).body.token;
    assert.equal((await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${admin}`)).status, 200);

    // removed from the list: the same token stops working and the stored role is demoted
    ADMIN_STUDENT_IDS.splice(ADMIN_STUDENT_IDS.indexOf("t-admin"), 1);
    try {
        assert.equal((await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${admin}`)).status, 403);
        const me = await request(app).get(`${BASE}/auth/me`).set("Authorization", `Bearer ${admin}`);
        assert.equal(me.body.role, "user");
        const row = await pool.query("SELECT role FROM users WHERE student_id = 't-admin'");
        assert.equal(row.rows[0].role, "user");
    } finally {
        ADMIN_STUDENT_IDS.push("t-admin");
    }

    // a deleted admin's token is rejected
    await pool.query("DELETE FROM users WHERE student_id = 't-admin'");
    assert.equal((await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${admin}`)).status, 401);
    await register("t-admin", "Admin");
});

test("rejects tampered tokens", async () => {
    const res = await request(app).get(`${BASE}/auth/me`).set("Authorization", "Bearer abc.def.ghi");
    assert.equal(res.status, 401);
});

test("usernames are validated, lowercased and unique", async () => {
    const bad = await register("t-bob", "Bob", "password123", "no spaces!");
    assert.equal(bad.status, 400);

    const taken = await register("t-bob", "Bob", "password123", "T_ADMIN");
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, "Username is already taken");

    const ok = await register("t-bob", "Bob", "password123", "Bob_B");
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.username, "bob_b");

    const rename = await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${ok.body.token}`).send({ username: "bobby" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.username, "bobby");
    await pool.query("DELETE FROM users WHERE student_id = 't-bob'");
});

test("internal user lookup requires the internal key", async () => {
    await register("t-bob", "Bob", "password123", "t_bob");

    assert.equal((await request(app).get("/internal/users?ids=t-bob")).status, 401);
    assert.equal((await request(app).get("/internal/users?ids=t-bob").set("X-Internal-Key", "wrong")).status, 401);

    const res = await request(app).get("/internal/users?ids=t-bob&usernames=T_ADMIN")
        .set("X-Internal-Key", process.env.INTERNAL_API_KEY);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(u => u.username).sort(), ["t_admin", "t_bob"]);
    assert.ok(res.body.every(u => !("password_hash" in u)));
});
