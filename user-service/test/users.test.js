// Integration tests: need a Postgres with db/init.sql applied (DB_* env vars)
process.env.JWT_SECRET ??= "test-secret-that-is-at-least-32-characters";
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

function register(studentId, name = studentId, password = "password123") {
    return request(app).post(`${BASE}/auth/register`).send({ name, studentId, password });
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
    assert.deepEqual(reg.body.user, { name: "Alice", studentId: "t-alice", role: "user" });

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
    const list = await request(app).get(`${BASE}/users`).set("Authorization", `Bearer ${admin.token}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.some(u => u.studentId === "t-bob"));
    assert.ok(list.body.every(u => !("password_hash" in u)));

    // a user cannot edit someone else
    const edit = await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${alice}`).send({ name: "Hacked" });
    assert.equal(edit.status, 403);

    // a user cannot promote themselves
    const promote = await request(app).put(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`).send({ role: "admin" });
    assert.equal(promote.status, 403);

    // owner renames and changes password
    const rename = await request(app).put(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`)
        .send({ name: "Alice B", currentPassword: "password123", newPassword: "newpassword1" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.name, "Alice B");
    const relogin = await request(app).post(`${BASE}/auth/login`).send({ studentId: "t-alice", password: "newpassword1" });
    assert.equal(relogin.status, 200);

    // admin renames and promotes another user
    const adminEdit = await request(app).put(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`).send({ name: "Robert", role: "admin" });
    assert.equal(adminEdit.status, 200);
    assert.equal(adminEdit.body.role, "admin");

    // owner deletes own account, admin deletes another
    assert.equal((await request(app).delete(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${bob}`)).status, 403);
    assert.equal((await request(app).delete(`${BASE}/users/t-alice`).set("Authorization", `Bearer ${alice}`)).status, 204);
    assert.equal((await request(app).delete(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`)).status, 204);
    assert.equal((await request(app).delete(`${BASE}/users/t-bob`).set("Authorization", `Bearer ${admin.token}`)).status, 404);
});

test("rejects tampered tokens", async () => {
    const res = await request(app).get(`${BASE}/auth/me`).set("Authorization", "Bearer abc.def.ghi");
    assert.equal(res.status, 401);
});
