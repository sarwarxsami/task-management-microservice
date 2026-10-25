const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../models/db');
const { ADMIN_STUDENT_IDS } = require('../config');
const { signToken, requireAuth } = require('../middleware/auth');
const { validName, validStudentId, validPassword } = require('../validation');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts, try again later" },
});

function publicUser(row) {
    return { name: row.name, studentId: row.student_id, role: row.role };
}

// Admins are bootstrapped from ADMIN_STUDENT_IDS
async function syncAdminRole(user) {
    if (ADMIN_STUDENT_IDS.includes(user.student_id) && user.role !== "admin") {
        await pool.query("UPDATE users SET role = 'admin' WHERE student_id = $1", [user.student_id]);
        user.role = "admin";
    }
    return user;
}

// POST /service/user-service/auth/register
router.post("/register", authLimiter, async (req, res) => {
    const { name, studentId, password } = req.body ?? {};

    if (!validName(name) || !validStudentId(studentId) || !validPassword(password)) {
        return res.status(400).json({
            error: "Name (1-100 chars), student ID (letters, digits, - or _) and password (8-72 chars) are required"
        });
    }

    const hash = await bcrypt.hash(password, 10);

    // Accounts created before login existed have no password yet; registering claims them
    const result = await pool.query(
        `INSERT INTO users (name, student_id, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id) DO UPDATE
             SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
             WHERE users.password_hash IS NULL
         RETURNING name, student_id, role`,
        [name.trim(), studentId, hash]
    );

    if (result.rows.length === 0) {
        return res.status(409).json({ error: "User already registered" });
    }

    const user = await syncAdminRole(result.rows[0]);
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// POST /service/user-service/auth/login
router.post("/login", authLimiter, async (req, res) => {
    const { studentId, password } = req.body ?? {};

    if (typeof studentId !== "string" || typeof password !== "string") {
        return res.status(400).json({ error: "Student ID and password are required" });
    }

    const result = await pool.query(
        "SELECT name, student_id, role, password_hash FROM users WHERE student_id = $1",
        [studentId]
    );
    const user = result.rows[0];

    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Invalid student ID or password" });
    }

    await syncAdminRole(user);
    return res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /service/user-service/auth/me
router.get("/me", requireAuth, async (req, res) => {
    const result = await pool.query(
        "SELECT name, student_id, role FROM users WHERE student_id = $1",
        [req.user.studentId]
    );

    if (result.rows.length === 0) {
        return res.status(401).json({ error: "Account no longer exists" });
    }

    return res.json(publicUser(result.rows[0]));
});

module.exports = { router, publicUser };
