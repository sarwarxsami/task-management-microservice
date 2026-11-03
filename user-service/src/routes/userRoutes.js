const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../models/db');
const { requireAuth, requireAdmin, requireSelf } = require('../middleware/auth');
const mailer = require('../mailer');
const { CODE_MINUTES, MAX_ATTEMPTS, RESEND_SECONDS, newCode, hashCode, codeMatches } = require('../emailCodes');
const { validName, validPassword, normalizeUsername, validUsername, normalizeEmail, validEmail } = require('../validation');
const { codeLimiter, USERNAME_TAKEN, EMAIL_TAKEN } = require('./authRoutes');

router.use(requireAuth);

// GET /service/user-service/users (admin)
// Admins only see each account's name and username; id is an opaque handle for deleting
router.get("/", requireAdmin, async (req, res) => {
    const result = await pool.query("SELECT id, name, username FROM users ORDER BY created_at, id");
    return res.json(result.rows);
});

// DELETE /service/user-service/users/by-id/:id (admin; tasks cascade)
router.delete("/by-id/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id" });
    }

    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }
    return res.status(204).end();
});

// PUT /service/user-service/users/:studentId (owner)
// { name?, username?, currentPassword + newPassword? }; roles come only from ADMIN_STUDENT_IDS
router.put("/:studentId", requireSelf, async (req, res) => {
    const { name, username, role, currentPassword, newPassword } = req.body ?? {};

    if (role !== undefined) {
        return res.status(403).json({ error: "Roles cannot be changed" });
    }

    const existing = await pool.query(
        "SELECT name, student_id, username, role, password_hash FROM users WHERE student_id = $1",
        [req.params.studentId]
    );
    const user = existing.rows[0];

    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    const updates = { name: user.name, username: user.username, password_hash: user.password_hash };

    if (name !== undefined) {
        if (!validName(name)) {
            return res.status(400).json({ error: "Name must be 1-100 characters" });
        }
        updates.name = name.trim();
    }

    if (username !== undefined) {
        const normalized = normalizeUsername(username);
        if (!validUsername(normalized)) {
            return res.status(400).json({ error: "Username must be 3-30 lowercase letters, digits or _" });
        }
        updates.username = normalized;
    }

    if (newPassword !== undefined) {
        if (!validPassword(newPassword)) {
            return res.status(400).json({ error: "Password must be 8-72 characters" });
        }
        if (!user.password_hash || !(await bcrypt.compare(currentPassword ?? "", user.password_hash))) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }
        updates.password_hash = await bcrypt.hash(newPassword, 10);
    }

    let result;
    try {
        result = await pool.query(
            `UPDATE users SET name = $1, username = $2, password_hash = $3
             WHERE student_id = $4
             RETURNING name, student_id, username, role`,
            [updates.name, updates.username, updates.password_hash, req.params.studentId]
        );
    } catch (error) {
        if (error.constraint === USERNAME_TAKEN) {
            return res.status(409).json({ error: "Username is already taken" });
        }
        throw error;
    }

    const row = result.rows[0];
    return res.json({ name: row.name, studentId: row.student_id, username: row.username, role: row.role });
});

// POST /service/user-service/users/:studentId/email (owner): emails a code to a new address
router.post("/:studentId/email", requireSelf, codeLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!validEmail(email)) {
        return res.status(400).json({ error: "A valid email is required" });
    }
    if (!mailer.configured()) {
        return res.status(503).json({ error: "Email codes are not available right now" });
    }
    const taken = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (taken.rows.length > 0) {
        return res.status(409).json({ error: "Email is already registered" });
    }

    const code = newCode();
    const saved = await pool.query(
        `INSERT INTO pending_emails (student_id, email, code_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))
         ON CONFLICT (student_id) DO UPDATE
             SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, attempts = 0,
                 expires_at = EXCLUDED.expires_at, sent_at = now()
             WHERE pending_emails.sent_at < now() - make_interval(secs => $5)
         RETURNING email`,
        [req.params.studentId, email, hashCode(code), CODE_MINUTES, RESEND_SECONDS]
    );
    if (saved.rows.length === 0) {
        return res.status(429).json({ error: "A code was just sent. Wait a minute before asking for another" });
    }

    try {
        await mailer.sendCode(email, code);
    } catch (error) {
        console.error("Could not send code:", error.message);
        await pool.query("DELETE FROM pending_emails WHERE student_id = $1", [req.params.studentId]);
        return res.status(502).json({ error: "Could not send the email. Try again later" });
    }
    return res.status(202).json({ email });
});

// POST /service/user-service/users/:studentId/email/verify (owner): the right code saves the address
router.post("/:studentId/email/verify", requireSelf, async (req, res) => {
    const code = req.body?.code;
    const pending = await pool.query(
        `UPDATE pending_emails SET attempts = attempts + 1
         WHERE student_id = $1 AND attempts < $2 AND expires_at > now()
         RETURNING email, code_hash`,
        [req.params.studentId, MAX_ATTEMPTS]
    );
    const row = pending.rows[0];
    if (!row) {
        return res.status(400).json({ error: "This code has expired. Ask for a new one" });
    }
    if (typeof code !== "string" || !codeMatches(code.trim(), row.code_hash)) {
        return res.status(400).json({ error: "Wrong code" });
    }

    try {
        await pool.query("UPDATE users SET email = $1 WHERE student_id = $2", [row.email, req.params.studentId]);
    } catch (error) {
        if (error.constraint === EMAIL_TAKEN) {
            return res.status(409).json({ error: "Email is already registered" });
        }
        throw error;
    }
    await pool.query("DELETE FROM pending_emails WHERE student_id = $1", [req.params.studentId]);
    // a reset code sent to the old address must not outlive it
    await pool.query("DELETE FROM pending_resets WHERE student_id = $1", [req.params.studentId]);
    return res.json({ email: row.email });
});

const TOUR_PAGES = ["tasks", "discover", "viewers", "account", "admin"];

// PUT /service/user-service/users/:studentId/tours/:page (owner): that page's tour was taken or declined
router.put("/:studentId/tours/:page", requireSelf, async (req, res) => {
    if (!TOUR_PAGES.includes(req.params.page)) {
        return res.status(400).json({ error: `Page must be one of ${TOUR_PAGES.join(", ")}` });
    }
    const result = await pool.query(
        `UPDATE users
         SET tours_done = CASE WHEN $2 = ANY(tours_done) THEN tours_done ELSE array_append(tours_done, $2) END
         WHERE student_id = $1
         RETURNING tours_done`,
        [req.params.studentId, req.params.page]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }
    return res.json({ toursDone: result.rows[0].tours_done });
});

// DELETE /service/user-service/users/:studentId (owner; tasks cascade)
router.delete("/:studentId", requireSelf, async (req, res) => {
    const result = await pool.query(
        "DELETE FROM users WHERE student_id = $1 RETURNING student_id",
        [req.params.studentId]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }

    return res.status(204).end();
});

module.exports = router;
