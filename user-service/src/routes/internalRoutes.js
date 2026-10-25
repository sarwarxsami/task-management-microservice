const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { requireInternalKey } = require('../middleware/internal');

router.use(requireInternalKey);

function splitParam(value) {
    return typeof value === "string" ? value.split(",").map(v => v.trim()).filter(Boolean) : [];
}

// GET /internal/users?ids=a,b  or  ?usernames=x,y
router.get("/users", async (req, res) => {
    const ids = splitParam(req.query.ids);
    const usernames = splitParam(req.query.usernames).map(u => u.toLowerCase());

    if (ids.length === 0 && usernames.length === 0) {
        return res.json([]);
    }

    const result = await pool.query(
        `SELECT name, student_id, username, role FROM users
         WHERE student_id = ANY($1) OR username = ANY($2)`,
        [ids, usernames]
    );

    return res.json(result.rows.map(row => ({
        name: row.name,
        studentId: row.student_id,
        username: row.username,
        role: row.role,
    })));
});

module.exports = router;
