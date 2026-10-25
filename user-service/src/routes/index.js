const express = require('express');
const router = express.Router();

const { router: authRoutes } = require('./authRoutes');
const userRoutes = require('./userRoutes');

router.get("/health", (req, res) => res.json({ status: "ok" }));
router.use("/auth", authRoutes);
router.use("/users", userRoutes);

module.exports = router;
