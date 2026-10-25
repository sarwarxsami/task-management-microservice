const express = require('express');
const router = express.Router();
const pool = require('../models/db');

// GET /service/user-service/show/user
router.get("/user", async (req, res) => {

    try {
        const allUsers = await pool.query(
            "SELECT name, student_id FROM users;"
        );
        return res.json(allUsers.rows);
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({
            error: "Internal Server Error"
        });
    }
});

module.exports = router;