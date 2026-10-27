const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../models/db');
const { requireAuth, requireAdmin, requireSelf } = require('../middleware/auth');
const { validName, validPassword, normalizeUsername, validUsername } = require('../validation');
const { USERNAME_TAKEN } = require('./authRoutes');

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
