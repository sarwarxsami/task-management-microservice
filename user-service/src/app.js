const express = require('express');
const app = express();

// Behind the nginx gateway; needed for per-client rate limiting
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));

const router = require("./routes/index.js");
app.use("/service/user-service",router);

// Internal API for other services; nginx only proxies /service/user-service
app.use("/internal", require("./routes/internalRoutes"));

app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Invalid JSON body" });
    }
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
