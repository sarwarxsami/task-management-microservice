const Pool = require('pg').Pool;
require('dotenv').config({ quiet: true });

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    // same budget as the Spring services (hikari maximum-pool-size=5)
    max: 5,
});

module.exports = pool;
