const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { JWT_SECRET, JWT_EXPIRES_IN, ADMIN_STUDENT_IDS } = require('../config');

// ADMIN_STUDENT_IDS is the only source of admin rights
function roleFor(studentId) {
    return ADMIN_STUDENT_IDS.includes(studentId) ? "admin" : "user";
}

function signToken(user) {
    return jwt.sign(
        { name: user.name },
        JWT_SECRET,
        { algorithm: "HS256", subject: user.student_id, expiresIn: JWT_EXPIRES_IN }
    );
}

// Verifies "Authorization: Bearer <jwt>" and sets req.user = { studentId, name }
function requireAuth(req, res, next) {
    const header = req.get("Authorization") || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
        req.user = { studentId: payload.sub, name: payload.name };
        return next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

// Checked on every request (not taken from the token), so removed admins and deleted accounts lose access at once
async function requireAdmin(req, res, next) {
    if (roleFor(req.user?.studentId) !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
    }
    const result = await pool.query("SELECT 1 FROM users WHERE student_id = $1", [req.user.studentId]);
    if (result.rows.length === 0) {
        return res.status(401).json({ error: "Account no longer exists" });
    }
    return next();
}

// Allows only the account owner (route param :studentId)
function requireSelf(req, res, next) {
    if (req.user?.studentId === req.params.studentId) {
        return next();
    }
    return res.status(403).json({ error: "Not allowed" });
}

module.exports = { roleFor, signToken, requireAuth, requireAdmin, requireSelf };
