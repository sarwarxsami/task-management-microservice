-- Idempotent schema: runs on first startup and again on every deploy.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    student_id VARCHAR(50) UNIQUE NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    task TEXT NOT NULL,

    CONSTRAINT fk_user
        FOREIGN KEY (student_id)
        REFERENCES users(student_id)
        ON DELETE CASCADE
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'medium', 'high'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_student_id ON tasks (student_id);

-- Usernames (public handle, separate from name and student ID)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);

-- Task visibility: only_me (default), trusted (owner's task viewers), open (everyone)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'only_me';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_visibility_check') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_visibility_check CHECK (visibility IN ('only_me', 'trusted', 'open'));
    END IF;
END $$;

-- social-service: Listed/Unlisted setting (no row = unlisted)
CREATE TABLE IF NOT EXISTS profiles (
    student_id VARCHAR(50) PRIMARY KEY REFERENCES users(student_id) ON DELETE CASCADE,
    listed BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- social-service: owner lets viewer see the owner's trusted tasks (one-way)
CREATE TABLE IF NOT EXISTS task_viewers (
    owner_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    viewer_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, viewer_id),
    CHECK (owner_id <> viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_task_viewers_viewer ON task_viewers (viewer_id);

-- social-service: requester asks owner to be added to the owner's task viewers
CREATE TABLE IF NOT EXISTS viewer_access_requests (
    id SERIAL PRIMARY KEY,
    requester_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    owner_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (requester_id, owner_id),
    CHECK (requester_id <> owner_id)
);

CREATE INDEX IF NOT EXISTS idx_viewer_requests_owner ON viewer_access_requests (owner_id);

-- social-service: Hand-picked audience of a Trusted task (no row = All Trusted).
-- The row stays even if every picked person goes, so the task never falls back to All Trusted.
CREATE TABLE IF NOT EXISTS task_audiences (
    task_id INT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- picked people; they also have to be on the owner's task viewers to see the task
CREATE TABLE IF NOT EXISTS task_audience_members (
    task_id INT NOT NULL REFERENCES task_audiences(task_id) ON DELETE CASCADE,
    viewer_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, viewer_id)
);

-- social-service: named groups inside an owner's task viewers.
-- A viewer may be in several groups; viewers in no group form the owner's Default group.
CREATE TABLE IF NOT EXISTS viewer_groups (
    id SERIAL PRIMARY KEY,
    owner_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    name VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS viewer_groups_owner_name ON viewer_groups (owner_id, lower(name));

CREATE TABLE IF NOT EXISTS viewer_group_members (
    group_id INT NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
    viewer_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_viewer_group_members_viewer ON viewer_group_members (viewer_id);

-- Trusted task audience mode: picked (task_audience_members) or groups (task_audience_groups,
-- plus the owner's Default group when include_default)
ALTER TABLE task_audiences ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'picked';
ALTER TABLE task_audiences ADD COLUMN IF NOT EXISTS include_default BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_audiences_mode_check') THEN
        ALTER TABLE task_audiences ADD CONSTRAINT task_audiences_mode_check CHECK (mode IN ('picked', 'groups'));
    END IF;
END $$;

-- a deleted group drops out here; the task then shows to nobody rather than to All Trusted
CREATE TABLE IF NOT EXISTS task_audience_groups (
    task_id INT NOT NULL REFERENCES task_audiences(task_id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, group_id)
);

-- user-service: when the user finished or skipped the first-login tour (NULL = show it)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_done_at TIMESTAMPTZ;

-- user-service: pages whose tour the user took or declined (tasks, discover, viewers, account, admin).
-- Replaces the single tour_done_at flag; whoever finished the old all-pages tour has seen every page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tours_done TEXT[] NOT NULL DEFAULT '{}';
UPDATE users SET tours_done = ARRAY['tasks', 'discover', 'viewers', 'account', 'admin']
    WHERE tour_done_at IS NOT NULL AND tours_done = '{}';

-- social-service: an id per Your Task Viewers entry, so a viewer can leave a list without
-- learning who owns it (owners who are Unlisted show as "User is Unlisted")
ALTER TABLE task_viewers ADD COLUMN IF NOT EXISTS id SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS task_viewers_id_key ON task_viewers (id);

-- user-service: email login. student_id stays as the internal account key (never shown); accounts
-- from before email existed have no address until they add one
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- user-service: registrations waiting for the emailed code; the account is created when it is entered
CREATE TABLE IF NOT EXISTS pending_registrations (
    email VARCHAR(254) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(30) NOT NULL,
    password_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user-service: an existing account adding or changing its email, waiting for the emailed code
CREATE TABLE IF NOT EXISTS pending_emails (
    student_id VARCHAR(50) PRIMARY KEY REFERENCES users(student_id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user-service: password resets waiting for the emailed code
CREATE TABLE IF NOT EXISTS pending_resets (
    student_id VARCHAR(50) PRIMARY KEY REFERENCES users(student_id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- social-service: profile description, one row per filled-in field, each with its own visibility.
-- field 'custom' is a user-made field with its own title and may repeat; every other field appears once
CREATE TABLE IF NOT EXISTS profile_details (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL REFERENCES users(student_id) ON DELETE CASCADE,
    field VARCHAR(30) NOT NULL,
    title VARCHAR(60),
    value TEXT NOT NULL,
    visibility VARCHAR(10) NOT NULL DEFAULT 'only_me' CHECK (visibility IN ('only_me', 'trusted', 'open'))
);

CREATE INDEX IF NOT EXISTS idx_profile_details_user ON profile_details (student_id);
CREATE UNIQUE INDEX IF NOT EXISTS profile_details_one_per_field ON profile_details (student_id, field) WHERE field <> 'custom';
