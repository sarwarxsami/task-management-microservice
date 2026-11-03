const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../models/db');
const { roleFor, signToken, requireAuth } = require('../middleware/auth');
const mailer = require('../mailer');
const { CODE_MINUTES, MAX_ATTEMPTS, RESEND_SECONDS, newCode, hashCode, codeMatches } = require('../emailCodes');
const { validName, validPassword, normalizeUsername, validUsername, normalizeEmail, validEmail } = require('../validation');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts, try again later" },
});

// Every request counts, successful or not: each one can send an email.
// Not lower: a whole class registering from one campus network shares an IP address
const codeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many codes requested, try again later" },
});

const USERNAME_TAKEN = "users_username_key";
const EMAIL_TAKEN = "users_email_key";

function publicUser(row) {
    return {
        name: row.name,
        studentId: row.student_id,
        username: row.username,
        email: row.email ?? null,
        role: row.role,
        toursDone: row.tours_done ?? [],
    };
}

// Keeps the stored role in step with ADMIN_STUDENT_IDS, promoting and demoting
async function syncRole(user) {
    const role = roleFor(user.student_id);
    if (user.role !== role) {
        await pool.query("UPDATE users SET role = $1 WHERE student_id = $2", [role, user.student_id]);
        user.role = role;
    }
    return user;
}

// POST /service/user-service/auth/register: checks the details and emails a code; no account exists yet
router.post("/register", codeLimiter, async (req, res) => {
    const { name, password } = req.body ?? {};
    const username = normalizeUsername(req.body?.username);
    const email = normalizeEmail(req.body?.email);

    if (!validName(name) || !validEmail(email) || !validPassword(password) || !validUsername(username)) {
        return res.status(400).json({
            error: "Name (1-100 chars), a valid email, username (3-30 lowercase letters, digits or _) and password (8-72 chars) are required"
        });
    }
    if (!mailer.configured()) {
        return res.status(503).json({ error: "Email codes are not available right now" });
    }

    const taken = await pool.query("SELECT email, username FROM users WHERE email = $1 OR username = $2", [email, username]);
    if (taken.rows.some(row => row.email === email)) {
        return res.status(409).json({ error: "Email is already registered" });
    }
    if (taken.rows.length > 0) {
        return res.status(409).json({ error: "Username is already taken" });
    }

    const code = newCode();
    const hash = await bcrypt.hash(password, 10);
    const saved = await pool.query(
        `INSERT INTO pending_registrations (email, name, username, password_hash, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))
         ON CONFLICT (email) DO UPDATE
             SET name = EXCLUDED.name, username = EXCLUDED.username, password_hash = EXCLUDED.password_hash,
                 code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = now()
             WHERE pending_registrations.sent_at < now() - make_interval(secs => $7)
         RETURNING email`,
        [email, name.trim(), username, hash, hashCode(code), CODE_MINUTES, RESEND_SECONDS]
    );
    if (saved.rows.length === 0) {
        return res.status(429).json({ error: "A code was just sent. Wait a minute before asking for another" });
    }

    try {
        await mailer.sendCode(email, code);
    } catch (error) {
        console.error("Could not send code:", error.message);
        await pool.query("DELETE FROM pending_registrations WHERE email = $1", [email]);
        return res.status(502).json({ error: "Could not send the email. Try again later" });
    }
    return res.status(202).json({ email });
});

// POST /service/user-service/auth/register/verify: the right code creates the account
router.post("/register/verify", authLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = req.body?.code;

    // counts the attempt first, so parallel guesses cannot get past the limit
    const pending = await pool.query(
        `UPDATE pending_registrations SET attempts = attempts + 1
         WHERE email = $1 AND attempts < $2 AND expires_at > now()
         RETURNING name, username, password_hash, code_hash`,
        [email, MAX_ATTEMPTS]
    );
    const row = pending.rows[0];
    if (!row) {
        return res.status(400).json({ error: "This code has expired. Register again to get a new one" });
    }
    if (typeof code !== "string" || !codeMatches(code.trim(), row.code_hash)) {
        return res.status(400).json({ error: "Wrong code" });
    }

    let result;
    try {
        result = await pool.query(
            `INSERT INTO users (name, student_id, username, email, password_hash)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING name, student_id, username, email, role, tours_done`,
            [row.name, `u-${crypto.randomUUID()}`, row.username, email, row.password_hash]
        );
    } catch (error) {
        if (error.constraint === USERNAME_TAKEN) {
            return res.status(409).json({ error: "Username is already taken" });
        }
        if (error.constraint === EMAIL_TAKEN) {
            return res.status(409).json({ error: "Email is already registered" });
        }
        throw error;
    }
    await pool.query("DELETE FROM pending_registrations WHERE email = $1", [email]);

    const user = await syncRole(result.rows[0]);
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// POST /service/user-service/auth/login: login is a username or an email
router.post("/login", authLimiter, async (req, res) => {
    const { login, password } = req.body ?? {};

    if (typeof login !== "string" || typeof password !== "string") {
        return res.status(400).json({ error: "Username or email and password are required" });
    }

    const result = await pool.query(
        `SELECT name, student_id, username, email, role, tours_done, password_hash FROM users
         WHERE username = $1 OR email = $1`,
        [login.trim().toLowerCase()]
    );
    const user = result.rows[0];

    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Wrong username, email or password" });
    }

    await syncRole(user);
    return res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /service/user-service/auth/password/forgot: emails a code if an account uses this address.
// The answer and its timing are the same either way, so it cannot be used to find out who has an account.
router.post("/password/forgot", codeLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!validEmail(email)) {
        return res.status(400).json({ error: "A valid email is required" });
    }
    if (!mailer.configured()) {
        return res.status(503).json({ error: "Email codes are not available right now" });
    }

    const account = await pool.query("SELECT student_id FROM users WHERE email = $1", [email]);
    const studentId = account.rows[0]?.student_id;
    if (studentId) {
        const code = newCode();
        const saved = await pool.query(
            `INSERT INTO pending_resets (student_id, code_hash, expires_at)
             VALUES ($1, $2, now() + make_interval(mins => $3))
             ON CONFLICT (student_id) DO UPDATE
                 SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = now()
                 WHERE pending_resets.sent_at < now() - make_interval(secs => $4)
             RETURNING student_id`,
            [studentId, hashCode(code), CODE_MINUTES, RESEND_SECONDS]
        );
        if (saved.rows.length > 0) {
            // not awaited: waiting for the mail server would show that the account exists
            mailer.sendCode(email, code).catch(async (error) => {
                console.error("Could not send code:", error.message);
                await pool.query("DELETE FROM pending_resets WHERE student_id = $1", [studentId]);
            });
        }
    }
    return res.status(202).json({ email });
});

// POST /service/user-service/auth/password/reset: the right code sets the new password
router.post("/password/reset", authLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const { code, newPassword } = req.body ?? {};

    if (!validPassword(newPassword)) {
        return res.status(400).json({ error: "Password must be 8-72 characters" });
    }

    // counts the attempt first, so parallel guesses cannot get past the limit
    const pending = await pool.query(
        `UPDATE pending_resets p SET attempts = p.attempts + 1
         FROM users u
         WHERE p.student_id = u.student_id AND u.email = $1 AND p.attempts < $2 AND p.expires_at > now()
         RETURNING p.student_id, p.code_hash`,
        [email, MAX_ATTEMPTS]
    );
    const row = pending.rows[0];
    if (!row) {
        return res.status(400).json({ error: "This code has expired. Ask for a new one" });
    }
    if (typeof code !== "string" || !codeMatches(code.trim(), row.code_hash)) {
        return res.status(400).json({ error: "Wrong code" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE student_id = $2", [hash, row.student_id]);
    await pool.query("DELETE FROM pending_resets WHERE student_id = $1", [row.student_id]);
    return res.status(204).end();
});

// GET /service/user-service/auth/me
router.get("/me", requireAuth, async (req, res) => {
    const result = await pool.query(
        "SELECT name, student_id, username, email, role, tours_done FROM users WHERE student_id = $1",
        [req.user.studentId]
    );

    if (result.rows.length === 0) {
        return res.status(401).json({ error: "Account no longer exists" });
    }

    return res.json(publicUser(await syncRole(result.rows[0])));
});

module.exports = { router, publicUser, codeLimiter, USERNAME_TAKEN, EMAIL_TAKEN };
