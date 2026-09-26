---
author: Rao Shahzaib
pubDatetime: 2026-10-01T10:00:00Z
title: "Week 6: Containerizing a Node.js Backend"
description: "Production-grade Node.js Docker images: slim base, npm ci, non-root user, graceful SIGTERM shutdown, /health endpoint, and a full Express hands-on lab."
tags: ["docker", "docker-360", "nodejs", "production"]
---

> 🐳 **Docker 360 — Week 6 of 16** | Run Node.js in production like a pro

## 🎯 Learning Objective

By the end of this week, you will be able to write a production-grade Dockerfile for a Node.js backend: slim base image, reproducible installs with `npm ci`, running as a non-root user, proper `SIGTERM` handling for graceful shutdowns, and a `/health` endpoint wired to Docker's `HEALTHCHECK`. *Iska matlab ye hai ke* — your API will start fast, stop cleanly, and tell the orchestrator when it's actually ready.

## 🎨 Visual Diagrams

### Production Dockerfile anatomy

```text
 FROM node:22-slim              ◀── small, Debian-based, has what prod needs
   │
   ├─ ENV NODE_ENV=production  ◀── faster Express, no dev warnings
   ├─ WORKDIR /app
   ├─ COPY package*.json ./
   ├─ RUN npm ci --omit=dev    ◀── reproducible, lockfile-exact install
   ├─ COPY --chown=node:node . .
   ├─ USER node                ◀── NEVER run as root in prod
   ├─ EXPOSE 3000
   ├─ HEALTHCHECK ...          ◀── Docker pings /health
   └─ CMD ["node","server.js"] ◀── exec form → signals reach Node
```

### Graceful shutdown: what happens on `docker stop`

```text
 docker stop api
      │
      │  SIGTERM sent to PID 1 (node) ──▶ app finishes in-flight requests
      ▼                                   closes DB connections, then exits
 ┌──────────┐   10s grace (default)   ┌───────────┐
 │ RUNNING  │ ─────────────────────▶ │  EXITED 0 │  ✅ clean
 └──────────┘                        └───────────┘

 WITHOUT a SIGTERM handler (or with shell-form CMD):

 ┌──────────┐   SIGTERM ignored/lost  ┌───────────┐
 │ RUNNING  │ ─────────────────────▶ │ SIGKILL   │  ❌ requests cut mid-flight
 └──────────┘    after 10s timeout   └───────────┘   ❌ exit code 137
```

*Iska matlab ye hai ke* — graceful shutdown is the difference between "deploy went fine" and "users saw errors during the deploy".

### Health check lifecycle

```text
 container starts
      │
      ▼
 ┌────────────┐   HEALTHCHECK every 30s:  GET /health
 │  starting  │ ──────────────────────────▶ 200 OK → healthy ✅
 └────────────┘                               │
                                              ▼ non-200 / timeout
                                         ┌─────────┐
                                         │unhealthy│ → orchestrator restarts
                                         └─────────┘    or stops routing
```

## 🧠 Theory Deep Dive

### `npm ci` vs `npm install` — reproducibility wins

| | `npm install` | `npm ci` |
|---|---|---|
| Reads | `package.json` (may update lockfile) | `package-lock.json` **only** |
| `node_modules` handling | Merges/incremental | Deletes and reinstalls clean |
| Speed in CI/Docker | Slower | Faster |
| Deterministic | ❌ Can drift | ✅ Byte-identical every time |

In Docker builds you always want `npm ci --omit=dev`: it installs exactly what the lockfile says, skips devDependencies, and fails loudly if `package.json` and the lockfile disagree — catching a real bug before it ships.

### Why never run as root

If an attacker escapes your app (e.g., through a dependency vulnerability), running as root inside the container makes host escape dramatically easier. The official Node images ship with a ready-made `node` user (uid 1000). Two lines — `USER node` plus `--chown` on your copied files — close the biggest easy hole.

> ⚠️ Switch to `USER node` **after** the `npm ci` step if you need root-only operations (like installing OS packages), or keep installs rootless-friendly. Files copied as root won't be writable by `node` — that's why we use `COPY --chown=node:node`.

### PID 1 and the signal problem

In a container, your `CMD` becomes **PID 1**. The Linux kernel treats PID 1 specially: it ignores `SIGTERM` unless the process explicitly handles it. Two rules follow:

1. **Use exec-form `CMD`** (`["node", "server.js"]`, not `node server.js`). Shell form wraps your app in `/bin/sh`, and the shell — not Node — gets the SIGTERM. Your handler never fires.
2. **Handle `SIGTERM` in code**: close the HTTP server (stop accepting new connections, finish in-flight ones), release resources, then exit.

Node's `server.close()` does exactly the graceful part: it stops accepting new connections but waits for existing ones to finish.

### `HEALTHCHECK` — let Docker watch your app

`HEALTHCHECK` tells Docker how to probe your container. Unlike a simple "is the process alive" check, hitting `/health` proves the app can actually serve traffic. Orchestrators (and `docker ps`) use the `healthy`/`unhealthy` status to decide routing and restarts.

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
```

`--start-period` gives slow-starting apps a grace window before failures count. *Iska matlab ye hai ke* — no false "unhealthy" verdicts while your app is still booting.

## 💻 Hands-On Lab

We will build a small Express API with a `/health` endpoint and graceful shutdown, containerize it production-style, and verify health + clean stops.

### Step 1 — Scaffold the app

```bash
mkdir -p ~/docker360/week6/api && cd ~/docker360/week6/api
cat > package.json <<'EOF'
{
  "name": "week6-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.21.2" }
}
EOF
cat > server.js <<'EOF'
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));
app.get("/", (req, res) => res.send("🐳 Docker 360 — Week 6 API is running"));

const server = app.listen(PORT, () => console.log(`API listening on :${PORT}`));

// Graceful shutdown: finish in-flight requests, then exit
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully...");
  server.close(() => {
    console.log("All connections closed. Bye!");
    process.exit(0);
  });
  // Safety net: force exit if connections hang
  setTimeout(() => process.exit(1), 8000).unref();
});
EOF
ls
```

### Step 2 — Generate the lockfile (needed for `npm ci`)

```bash
docker run --rm -v "$PWD":/app -w /app node:22-slim npm install --package-lock-only
ls package-lock.json
```

✅ **Expected result:** `package-lock.json` exists — generated inside a container, no local Node needed.

### Step 3 — Write the production Dockerfile

Create `Dockerfile`:

```dockerfile
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Deps first for layer caching; lockfile-exact install, no devDeps
COPY package*.json ./
RUN npm ci --omit=dev

# App code owned by the non-root user
COPY --chown=node:node . .
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Exec form → SIGTERM reaches Node directly
CMD ["node", "server.js"]
```

Also add a `.dockerignore`:

```text
node_modules
.git
*.log
```

### Step 4 — Build and run

```bash
docker build -t week6-api:1.0 .
docker run -d --name api -p 3000:3000 -e PORT=3000 week6-api:1.0
sleep 3
curl -s http://localhost:3000/health
```

✅ **Expected result:** `{"status":"ok","uptime":...}` — the API is up and configurable via env var.

### Step 5 — Verify the health status and non-root user

```bash
sleep 12
docker inspect api --format '{{.State.Health.Status}}'
docker exec api whoami
```

✅ **Expected result:** `healthy` and `node` — Docker's health check passes and the app runs as the non-root `node` user.

### Step 6 — Prove the graceful shutdown works

```bash
# Start a slow request in the background (takes 5s to respond)
docker exec -d api node -e "setTimeout(()=>{},5000)" 2>/dev/null
time docker stop api
docker logs api --tail 5
```

✅ **Expected result:** logs show `SIGTERM received — shutting down gracefully...` then `All connections closed. Bye!`, and `docker stop` completes in ~1s (not the full 10s timeout). *Iska matlab ye hai ke* — the app exited on its own terms instead of being SIGKILLed.

Compare with the ugly version: rebuild the image with shell-form `CMD node server.js`, run it, and `docker stop` will hang the full 10 seconds before exit code 137. Try it once — the difference sticks in memory.

### Step 7 — Clean up

```bash
docker rm api
docker rmi week6-api:1.0
```

## ✅ Checkpoint

**Q1: Why is `npm ci --omit=dev` better than `npm install` in a production Dockerfile?**
A1: `npm ci` installs exactly what `package-lock.json` specifies (deterministic, faster in clean environments) and `--omit=dev` skips devDependencies, keeping the image lean. It also fails if the lockfile is out of sync — catching real issues early.

**Q2: What breaks if you use shell-form `CMD node server.js` instead of exec form?**
A2: The shell (`/bin/sh`) becomes PID 1 and receives the SIGTERM, not Node. Your graceful-shutdown handler never runs, so `docker stop` hangs until the 10s timeout and ends with SIGKILL (exit 137).

**Q3: Why run the container as `USER node` instead of root?**
A3: If the app is compromised, a non-root user limits what the attacker can do inside the container and makes container-escape to the host much harder. It's two lines of config for a major security win.

**Q4: What does `HEALTHCHECK` give you that "container is running" doesn't?**
A4: It proves the app actually serves traffic (via `/health`), not just that the process exists. Docker reports `healthy`/`unhealthy`, and orchestrators use it for routing decisions and automatic restarts.

## 🔜 Next Week

Week 7: stateful services — running PostgreSQL in Docker with init scripts, named volumes, and real backup/restore drills.
