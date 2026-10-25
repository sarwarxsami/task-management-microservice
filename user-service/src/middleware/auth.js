const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');

function signToken(user) {
    return jwt.sign(
        { name: user.name, role: user.role },
        JWT_SECRET,
        { algorithm: "HS256", subject: user.student_id, expiresIn: JWT_EXPIRES_IN }
    );
}

// Verifies "Authorization: Bearer <jwt>" and sets req.user = { studentId, name, role }
function requireAuth(req, res, next) {
    const header = req.get("Authorization") || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
        req.user = { studentId: payload.sub, name: payload.name, role: payload.role };
        return next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
    }
    return next();
}

// Allows the account owner (route param :studentId) or an admin
function requireSelfOrAdmin(req, res, next) {
    if (req.user?.role === "admin" || req.user?.studentId === req.params.studentId) {
        return next();
    }
    return res.status(403).json({ error: "Not allowed" });
}

module.exports = { signToken, requireAuth, requireAdmin, requireSelfOrAdmin };
