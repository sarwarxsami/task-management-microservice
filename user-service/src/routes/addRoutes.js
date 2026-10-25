const express = require('express');
const router = express.Router();
const pool = require('../models/db');

// POST /service/user-service/add/user
router.post("/user", async (req, res) => {
    const { name, studentId } = req.body;

    if (!name || !studentId) {
        return res.status(400).json({
            error: "Missing required fields"
        });
    }

    try {
        const existingUser = await pool.query(
            "SELECT id FROM users WHERE student_id = $1",
            [studentId]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                error: "User already registered"
            });
        }

        await pool.query(
            "INSERT INTO users (name, student_id) VALUES ($1, $2)",
            [name, studentId]
        );

        return res.status(201).send("User added successfully");

    } catch (error) {
        console.error("Error adding user:", error);

        return res.status(500).json({
            error: "Internal Server Error"
        });
    }
});


module.exports = router;