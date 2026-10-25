CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    student_id VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    task TEXT NOT NULL,

    CONSTRAINT fk_user
        FOREIGN KEY (student_id)
        REFERENCES users(student_id)
        ON DELETE CASCADE
);
