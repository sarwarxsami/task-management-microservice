const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../models/db');
const { requireAuth, requireAdmin, requireSelfOrAdmin } = require('../middleware/auth');
const { validName, validPassword, normalizeUsername, validUsername } = require('../validation');
const { USERNAME_TAKEN } = require('./authRoutes');

router.use(requireAuth);

// GET /service/user-service/users (admin)
router.get("/", requireAdmin, async (req, res) => {
    const result = await pool.query(
        `SELECT name, student_id, username, role, created_at, (password_hash IS NOT NULL) AS has_password
         FROM users
         ORDER BY created_at, id`
    );

    return res.json(result.rows.map(row => ({
        name: row.name,
        studentId: row.student_id,
        username: row.username,
        role: row.role,
        createdAt: row.created_at,
        hasPassword: row.has_password,
    })));
});

// PUT /service/user-service/users/:studentId
// Owner: { name?, username?, currentPassword + newPassword? }; admin: { name?, username?, role? }
router.put("/:studentId", requireSelfOrAdmin, async (req, res) => {
    const { name, username, role, currentPassword, newPassword } = req.body ?? {};
    const isAdmin = req.user.role === "admin";
    const isSelf = req.user.studentId === req.params.studentId;

    const existing = await pool.query(
        "SELECT name, student_id, username, role, password_hash FROM users WHERE student_id = $1",
        [req.params.studentId]
    );
    const user = existing.rows[0];

    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    const updates = { name: user.name, username: user.username, role: user.role, password_hash: user.password_hash };

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

    if (role !== undefined) {
        if (!isAdmin) {
            return res.status(403).json({ error: "Only admins can change roles" });
        }
        if (!["user", "admin"].includes(role)) {
            return res.status(400).json({ error: "Role must be 'user' or 'admin'" });
        }
        if (isSelf && role !== "admin") {
            return res.status(400).json({ error: "You cannot remove your own admin role" });
        }
        updates.role = role;
    }

    if (newPassword !== undefined) {
        if (!isSelf) {
            return res.status(403).json({ error: "Only the account owner can change the password" });
        }
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
            `UPDATE users SET name = $1, username = $2, role = $3, password_hash = $4
             WHERE student_id = $5
             RETURNING name, student_id, username, role`,
            [updates.name, updates.username, updates.role, updates.password_hash, req.params.studentId]
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

// DELETE /service/user-service/users/:studentId (owner or admin; tasks cascade)
router.delete("/:studentId", requireSelfOrAdmin, async (req, res) => {
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
