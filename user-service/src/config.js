require('dotenv').config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
}

if (!INTERNAL_API_KEY || INTERNAL_API_KEY.length < 32) {
    throw new Error("INTERNAL_API_KEY must be set and at least 32 characters long");
}

module.exports = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET,
    INTERNAL_API_KEY,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "8h",
    ADMIN_STUDENT_IDS: (process.env.ADMIN_STUDENT_IDS || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean),
};
