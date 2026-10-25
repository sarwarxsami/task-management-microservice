const crypto = require('crypto');
const { INTERNAL_API_KEY } = require('../config');

const expected = Buffer.from(INTERNAL_API_KEY);

// Service-to-service calls carry the shared key; these routes are not exposed by the gateway
function requireInternalKey(req, res, next) {
    const provided = Buffer.from(req.get("X-Internal-Key") || "");

    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return res.status(401).json({ error: "Invalid internal key" });
    }
    return next();
}

module.exports = { requireInternalKey };
