(This Readme.md is LLM Generated)
# Task Management Microservice

A microservices-based task management system deployed on AWS EC2 with a full CI/CD pipeline, reverse proxy, and HTTPS.

---

## Architecture

```
internet
    │
    │ HTTPS :443 / HTTP :80
    ▼
Nginx (reverse proxy + SSL termination)
    │                   │
    │ /service/          │ /service/
    │ user-service       │ task-service
    ▼                   ▼
user-service         task-service
(Node.js :3000)      (Spring Boot :8080)
    │                   │
    └────────┬──────────┘
             ▼
        PostgreSQL
      (single instance)
```

---

## Features

- **Accounts** — register / log in with student ID and password (bcrypt-hashed), JWT sessions, change name and password, delete own account.
- **Roles** — `user` manages only their own tasks; `admin` sees and edits everyone's tasks and manages users (rename, promote/demote, delete). Admins are bootstrapped with `ADMIN_STUDENT_IDS`.
- **Tasks** — title, optional description and deadline, priority (low / medium / high), mark done/undone, edit inline, delete, clear all completed.
- **Organising** — summary counts (total, active, completed, due today, overdue), status filter (all / active / completed / overdue), search, sort by newest, deadline, priority or title, overdue and due-soon highlighting.
- **Per-user view** — admins can switch between their own tasks, all tasks, or any single user's tasks, and assign new tasks to a user.

---

## Services

All endpoints except `health`, `register` and `login` require `Authorization: Bearer <token>`.

### user-service — Node.js
Owns users and authentication; issues HS256 JWTs (`sub` = student ID, `name`, `role`, 8h expiry). Login/register are rate-limited per client IP (20 failed attempts per 15 minutes).

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/service/user-service/health` | public | Health check |
| POST | `/service/user-service/auth/register` | public | Create an account → `{ token, user }` |
| POST | `/service/user-service/auth/login` | public | Log in → `{ token, user }` |
| GET | `/service/user-service/auth/me` | any user | Current user |
| GET | `/service/user-service/users` | admin | List users |
| PUT | `/service/user-service/users/:studentId` | owner or admin | Owner: `name`, `currentPassword` + `newPassword`. Admin: `name`, `role` |
| DELETE | `/service/user-service/users/:studentId` | owner or admin | Delete user and (via cascade) their tasks |

**POST** `/service/user-service/auth/register`
```json
{
    "name": "Sami Sarwar",
    "studentId": "12345",
    "password": "at-least-8-chars"
}
```

Users created before accounts existed have no password; registering with their student ID sets one (once).

---

### task-service — Spring Boot (Java)
Owns tasks; validates the JWT with Spring Security (OAuth2 resource server, shared `JWT_SECRET`). Tasks owned by someone else return `404` for non-admins.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/service/task-service/health` | public | Health check |
| GET | `/service/task-service/tasks?studentId=` | user: own / admin: any or all | List tasks |
| POST | `/service/task-service/tasks` | any user | Create a task (admins may set `studentId`) |
| PUT | `/service/task-service/tasks/:id` | owner or admin | Update title, description, deadline, priority |
| PATCH | `/service/task-service/tasks/:id/status` | owner or admin | `{ "completed": true }` |
| DELETE | `/service/task-service/tasks/:id` | owner or admin | Delete a task |
| DELETE | `/service/task-service/tasks/completed` | any user | Delete own completed tasks |

**POST** `/service/task-service/tasks`
```json
{
    "title": "Learn Docker",
    "description": "Multi-stage builds and compose",
    "deadline": "2026-11-30",
    "priority": "high"
}
```

**Response**
```json
{
    "id": 1,
    "studentId": "12345",
    "title": "Learn Docker",
    "description": "Multi-stage builds and compose",
    "deadline": "2026-11-30",
    "priority": "high",
    "completed": false,
    "completedAt": null,
    "createdAt": "2026-10-25T20:03:28Z",
    "updatedAt": "2026-10-25T20:03:28Z"
}
```

---

## Tech Stack

| Layer | Technology | Detail |
|---|---|---|
| user-service | Node.js (Express) | Users, authentication (bcrypt, JWT), rate limiting |
| task-service | Spring Boot (Java) + Spring Security | Tasks API, JWT resource server |
| Database | PostgreSQL | Single shared instance for both services |
| Containerization | Docker | Each service runs in its own container |
| Orchestration | Docker Compose | Manages all containers, networks, and volumes |
| Reverse Proxy | Nginx | Single entry point, routes traffic to services |
| SSL | Let's Encrypt (Certbot) | Free HTTPS certificate, auto-renewed |
| CI/CD | GitHub Actions | Builds images, pushes to Docker Hub, deploys to EC2 |
| Registry | Docker Hub | Stores built images for both services |
| Cloud | AWS EC2 (Ubuntu) | Single VM running all containers |
| Domain | Namecheap (.me) | Via GitHub Student Developer Pack |

---

## What Was Built and Done

- **Dockerized both services** — each service has a multi-stage Dockerfile: a builder stage compiles/installs, a runtime stage runs only the output as a non-root user.
- **Multi-stage Docker builds** — builder stage uses full JDK/Node for compiling, runtime stage uses slim JRE/Node so production images carry no build tools or source code.
- **Single PostgreSQL instance** — one database container shared across both services via Docker internal networking.
- **Docker Compose orchestration** — all four containers (user-service, task-service, postgres, nginx) defined and managed in one `docker-compose.yml` with networks, volumes, pinned image versions, `restart: unless-stopped`, and healthchecks: services wait for a healthy Postgres, and deploys wait (`docker compose up --wait`) until both services report healthy.
- **Custom Docker networks** — `user-net` connects user-service and postgres; `task-net` connects task-service and postgres; Nginx sits on both networks to reach all services.
- **Named volumes** — postgres data persisted in a named Docker volume so data survives container restarts.
- **Environment variables via env\_file** — credentials are not hard-coded; Postgres and both services read from a `.env` file on the VM that is git-ignored and never baked into an image. `.env.example` lists the required keys (`DB_*`, `JWT_SECRET`, `ADMIN_STUDENT_IDS`).
- **GitHub Actions CI/CD pipeline** — on every push to `main`, the workflow validates the compose and Nginx configs, runs both services' integration tests against a Postgres service container, builds both images and pushes them to Docker Hub tagged `latest` and the commit SHA, copies the compose file, Nginx config, SQL and frontend to the VM via SCP, runs `docker compose pull && docker compose up -d` with that SHA (no `down`, so no full outage), and finishes with a smoke test against the live HTTPS endpoints (health checks plus a check that protected endpoints reject anonymous requests).
- **Docker Hub image registry** — built images stored at `sarwarxsami/task-service` and `sarwarxsami/user-service`. Every commit has its own tag, so rolling back is `IMAGE_TAG=<old-sha> docker compose up -d`.
- **SSH key-pair authentication** — dedicated ED25519 key pair generated for GitHub Actions; public key on the VM, private key stored as a GitHub Secret.
- **GitHub Secrets** — Docker Hub credentials, VM IP, SSH username, and private key stored as encrypted secrets, never exposed in workflow logs.
- **Nginx reverse proxy** — single Nginx container routes all traffic: `/service/user-service/*` → user-service, `/service/task-service/*` → task-service, `/` → static frontend. App services have no public ports.
- **HTTPS with Let's Encrypt** — Certbot issued a free SSL certificate for `task.sarwarxsami.me`; Nginx handles SSL termination; HTTP automatically redirects to HTTPS. Nginx serves `/.well-known/acme-challenge/` from `/var/www/certbot` so renewals work while it holds port 80 (see *Certificate renewal* below).
- **Custom domain** — `sarwarxsami.me` registered free via GitHub Student Developer Pack on Namecheap; `task.sarwarxsami.me` subdomain pointed to EC2 via A record.
- **EC2 Security Group firewall** — only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) open publicly; all app ports (3000, 8080, 5432) closed to the internet.
- **Static frontend** — plain HTML, CSS, and JS served directly by Nginx; communicates with both backend services via same-origin `fetch` calls. User data is rendered with `textContent` (never `innerHTML`) and a Content-Security-Policy header is set.
- **Database initialization and migrations** — `db/init.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). It runs automatically on first startup, and every deploy backs up the database (`~/backups`, last 10 kept) and re-applies it before starting new containers. The schema is owned by this file; Hibernate is set to `ddl-auto=none`.
- **Shell automation** — a local `connect.sh` script (kept outside this repo) resolves EC2 DNS to the current public IP, updates the `VM_HOST` GitHub Secret via GitHub CLI, and SSHes into the VM in one command; handles the dynamic IP problem of non-Elastic EC2 instances.

---

## Project Structure

```
task-management-microservice/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions CI/CD workflow
├── task-service/               # Spring Boot service
│   ├── Dockerfile
│   └── src/
├── user-service/               # Node.js service
│   ├── Dockerfile
│   └── src/
├── frontend/                   # Static frontend served by Nginx
│   ├── index.html
│   ├── style.css
│   └── app.js
├── api-gateway/
│   └── nginx.conf              # Nginx reverse proxy config
├── db/
│   └── init.sql                # Database initialization script
├── docker-compose.yml          # All services, networks, volumes
├── .env.example                # Required keys; real .env lives only on the VM (git-ignored)
└── README.md                   # What you are reading (Hopefully)
```

---

## Certificate renewal

Nginx owns port 80, so Certbot uses the webroot method (`authenticator = webroot`, `/var/www/certbot`) instead of `--standalone`; Nginx serves `/.well-known/acme-challenge/` from that directory. The `certbot.timer` on the VM renews automatically, and a deploy hook reloads Nginx with no downtime:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#!/bin/sh
docker exec nginx nginx -s reload
```

Check renewal manually with:

```bash
sudo certbot renew --dry-run --no-random-sleep-on-renew
```

---

## Live

**URL:** [https://task.sarwarxsami.me](https://task.sarwarxsami.me)
