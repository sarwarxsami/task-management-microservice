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

## Services

### user-service — Node.js
Owns users: registration and listing.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/service/user-service/add/user` | Register a new user |
| GET | `/service/user-service/show/user` | List all users |

**POST** `/service/user-service/add/user`
```json
{
    "name": "Sami Sarwar",
    "studentId": "12345"
}
```

**GET** `/service/user-service/show/user`
```json
[
    {
        "name": "Sami Sarwar",
        "student_id": "12345"
    }
]
```

---

### task-service — Spring Boot (Java)
Owns tasks: adding and listing.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/service/task-service/add/task` | Add a task for an existing user (`404` if the user does not exist) |
| GET | `/service/task-service/show/task` | List all tasks |

**POST** `/service/task-service/add/task`
```json
{
    "studentId": "12345",
    "task": "Learn Docker"
}
```

**GET** `/service/task-service/show/task`
```json
[
    {
        "id": 1,
        "studentId": "12345",
        "task": "Learn Docker"
    }
]
```

---

## Tech Stack

| Layer | Technology | Detail |
|---|---|---|
| user-service | Node.js | REST API for user and task management |
| task-service | Spring Boot (Java) | REST API for adding and fetching tasks |
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
- **Docker Compose orchestration** — all four containers (user-service, task-service, postgres, nginx) defined and managed in one `docker-compose.yml` with networks, volumes, pinned image versions, `restart: unless-stopped`, and a Postgres healthcheck the services wait on before starting.
- **Custom Docker networks** — `user-net` connects user-service and postgres; `task-net` connects task-service and postgres; Nginx sits on both networks to reach all services.
- **Named volumes** — postgres data persisted in a named Docker volume so data survives container restarts.
- **Environment variables via env\_file** — credentials are not hard-coded; Postgres and both services read from a `.env` file on the VM that is git-ignored and never baked into an image. `.env.example` lists the required keys.
- **GitHub Actions CI/CD pipeline** — on every push to `main`, the workflow validates the compose and Nginx configs, runs the task-service tests against a Postgres service container, builds both images and pushes them to Docker Hub tagged `latest` and the commit SHA, copies the compose file, Nginx config, SQL and frontend to the VM via SCP, runs `docker compose pull && docker compose up -d` with that SHA (no `down`, so no full outage), and finishes with a smoke test against the live HTTPS endpoints.
- **Docker Hub image registry** — built images stored at `sarwarxsami/task-service` and `sarwarxsami/user-service`. Every commit has its own tag, so rolling back is `IMAGE_TAG=<old-sha> docker compose up -d`.
- **SSH key-pair authentication** — dedicated ED25519 key pair generated for GitHub Actions; public key on the VM, private key stored as a GitHub Secret.
- **GitHub Secrets** — Docker Hub credentials, VM IP, SSH username, and private key stored as encrypted secrets, never exposed in workflow logs.
- **Nginx reverse proxy** — single Nginx container routes all traffic: `/service/user-service/*` → user-service, `/service/task-service/*` → task-service, `/` → static frontend. App services have no public ports.
- **HTTPS with Let's Encrypt** — Certbot issued a free SSL certificate for `task.sarwarxsami.me`; Nginx handles SSL termination; HTTP automatically redirects to HTTPS. Nginx serves `/.well-known/acme-challenge/` from `/var/www/certbot` so renewals work while it holds port 80 (see *Certificate renewal* below).
- **Custom domain** — `sarwarxsami.me` registered free via GitHub Student Developer Pack on Namecheap; `task.sarwarxsami.me` subdomain pointed to EC2 via A record.
- **EC2 Security Group firewall** — only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) open publicly; all app ports (3000, 8080, 5432) closed to the internet.
- **Static frontend** — plain HTML, CSS, and JS served directly by Nginx; communicates with both backend services via same-origin `fetch` calls. User data is rendered with `textContent` (never `innerHTML`) and a Content-Security-Policy header is set.
- **Database initialization** — `db/init.sql` mounted into the Postgres container via volume; runs automatically on first startup to set up the schema (idempotent `CREATE TABLE IF NOT EXISTS`). The schema is owned by this file; Hibernate is set to `ddl-auto=none`.
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

Nginx owns port 80, so Certbot must use the webroot method instead of `--standalone`. One-time switch on the VM:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d task.sarwarxsami.me --force-renewal
```

Then add a deploy hook so Nginx picks up renewed certificates:

```bash
echo 'docker restart nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/restart-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-nginx.sh
```

---

## Live

**URL:** [https://task.sarwarxsami.me](https://task.sarwarxsami.me)
