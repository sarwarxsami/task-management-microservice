const crypto = require('crypto');
const { JWT_SECRET } = require('./config');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

function newCode() {
    return String(crypto.randomInt(100000, 1000000));
}

// Keyed, because a plain hash of six digits could be reversed from a database copy
function hashCode(code) {
    return crypto.createHmac("sha256", JWT_SECRET).update(String(code)).digest("hex");
}

function codeMatches(code, hash) {
    const given = Buffer.from(hashCode(code));
    const stored = Buffer.from(hash);
    return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

module.exports = { CODE_MINUTES, MAX_ATTEMPTS, RESEND_SECONDS, newCode, hashCode, codeMatches };
