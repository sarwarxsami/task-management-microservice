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
Handles user registration and task input.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/service/user-service/add/user` | Register a new user |
| POST | `/service/user-service/add/task` | Add a task for a user |
| GET | `/service/user-service/show/user` | List all users |

**POST** `/service/user-service/add/user`
```json
{
    "name": "Sami Sarwar",
    "studentId": "12345"
}
```

**POST** `/service/user-service/add/task`
```json
{
    "studentId": "12345",
    "task": "Learn Docker"
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
Handles fetching tasks for users.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/service/task-service/show/task` | List all tasks with user info |

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
| task-service | Spring Boot (Java) | REST API for fetching tasks |
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

- **Dockerized both services** — each service has a multi-stage Dockerfile: a builder stage compiles/installs, a runtime stage runs only the output. Reduces image size significantly.
- **Multi-stage Docker builds** — builder stage uses full JDK/Node for compiling, runtime stage uses slim JRE/Node so production images carry no build tools or source code.
- **Single PostgreSQL instance** — one database container shared across both services via Docker internal networking.
- **Docker Compose orchestration** — all four containers (user-service, task-service, postgres, nginx) defined and managed in one `docker-compose.yml` with correct networks, volumes, and `depends_on` ordering.
- **Custom Docker networks** — `user-net` connects user-service and postgres; `task-net` connects task-service and postgres; Nginx sits on both networks to reach all services.
- **Named volumes** — postgres data persisted in a named Docker volume so data survives container restarts.
- **Environment variables via env\_file** — credentials never hard-coded; each service reads from a `.env` file mounted at runtime and excluded from the image and git history.
- **GitHub Actions CI/CD pipeline** — on every push to `main`, the workflow builds both Docker images, pushes them to Docker Hub, copies updated files to the VM via SCP, then SSHes in and runs `docker compose pull && docker compose up -d`.
- **Docker Hub image registry** — built images stored at `sarwarxsami/task-service` and `sarwarxsami/user-service`, pulled by the VM on every deploy.
- **SSH key-pair authentication** — dedicated ED25519 key pair generated for GitHub Actions; public key on the VM, private key stored as a GitHub Secret.
- **GitHub Secrets** — Docker Hub credentials, VM IP, SSH username, and private key stored as encrypted secrets, never exposed in workflow logs.
- **Nginx reverse proxy** — single Nginx container routes all traffic: `/service/user-service/*` → user-service, `/service/task-service/*` → task-service, `/` → static frontend. App services have no public ports.
- **HTTPS with Let's Encrypt** — Certbot issued a free SSL certificate for `task.sarwarxsami.me`; Nginx handles SSL termination; HTTP automatically redirects to HTTPS.
- **Custom domain** — `sarwarxsami.me` registered free via GitHub Student Developer Pack on Namecheap; `task.sarwarxsami.me` subdomain pointed to EC2 via A record.
- **EC2 Security Group firewall** — only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) open publicly; all app ports (3000, 8080, 5432) closed to the internet.
- **Static frontend** — plain HTML, CSS, and JS served directly by Nginx; communicates with both backend services via `fetch` API calls to the HTTPS endpoints.
- **Database initialization** — `db/init.sql` mounted into the Postgres container via volume; runs automatically on first startup to set up schema.
- **Shell automation** — `connect.sh` script resolves EC2 DNS to current public IP, updates the `VM_HOST` GitHub Secret via GitHub CLI, updates `upload.sh`, and SSHes into the VM in one command; handles the dynamic IP problem of non-Elastic EC2 instances.

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
├── nginx/
│   └── nginx.conf              # Nginx reverse proxy config
├── db/
│   └── init.sql                # Database initialization script
├── docker-compose.yml          # All services, networks, volumes
├── .env                        # Directly Passed to VM using SCP
└── README.md                   # What you are reading (Hopefully)
```

---

## Live

**URL:** [https://task.sarwarxsami.me](https://task.sarwarxsami.me)
