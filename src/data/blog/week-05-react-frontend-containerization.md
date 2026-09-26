---
author: Rao Shahzaib
pubDatetime: 2026-09-15T00:00:00Z
title: "Week 5: Containerizing a React Frontend"
description: "Ship a React app in a tiny nginx container with multi-stage Docker builds — node build stage, .dockerignore, build args for API URLs, and SPA routing fallback, all in one hands-on lab."
tags: ["docker", "docker-360", "react", "nginx"]
---

> 🐳 **Docker 360 — Week 5 of 16** | Ship a React app in a tiny nginx container

## 🎯 Learning Objective

By the end of this week, you will be able to containerize any React (Vite) frontend using a multi-stage Dockerfile that builds the app with Node and serves the static output with nginx. You will also understand `.dockerignore`, build-time arguments for API URLs, and how to make client-side routing work inside a container. *Iska matlab ye hai ke* — after this post, `docker build` + `docker run` will give you a production-ready frontend in under 50 MB.

## 🎨 Visual Diagrams

### Multi-stage build: what goes where

```text
 ┌────────────────────────────────────┐
 │  STAGE 1: "build"  (node:22-alpine) │
 │                                    │
 │   1. COPY package*.json            │
 │   2. RUN npm ci        (deps)      │
 │   3. COPY . .          (source)    │
 │   4. RUN npm run build (→ /app/dist)│
 │                                    │
 │   ~350 MB of tools — THROWN AWAY   │
 └──────────────┬─────────────────────┘
                │  COPY --from=build /app/dist
                ▼
 ┌────────────────────────────────────┐
 │  STAGE 2: runtime (nginx:1.27-alpine)│
 │                                    │
 │   /usr/share/nginx/html  ← dist    │
 │   nginx serves static files on :80 │
 │                                    │
 │   Final image ≈ 45 MB ✅            │
 └────────────────────────────────────┘
```

*Iska matlab ye hai ke* — the heavy Node toolchain never ships to production. Only the compiled HTML/CSS/JS travels in the final image.

### Request flow: SPA routing inside nginx

```text
 Browser
   │
   │  GET /dashboard   (a React Router page — no real file!)
   ▼
 ┌─────────────────────────────┐
 │  nginx container  (:8080→:80)│
 │                             │
 │  try_files $uri $uri/       │
 │       /index.html;  ◀── fallback: "file nahi mili?
 │                             │     index.html de do,
 │                             │     React Router sambhal lega"
 └─────────────────────────────┘
```

### Build context: why `.dockerignore` matters

```text
 WITHOUT .dockerignore              WITH .dockerignore
 ─────────────────────              ──────────────────
 build context: 412 MB              build context: 3.1 MB
  ├─ node_modules/  (useless!)       ├─ src/
  ├─ dist/          (stale!)         ├─ public/
  ├─ .git/          (heavy!)         ├─ package*.json
  └─ src/ ...                       └─ vite.config.js

 Slower uploads, broken cache  ──▶  Fast builds, correct layer cache
```

## 🧠 Theory Deep Dive

### Why multi-stage builds exist

A React app has two lives: **build time** (needs Node, npm, devDependencies, ~350 MB) and **run time** (needs only a static file server — nginx, ~25 MB). A single-stage image drags both lives into production: bigger images, slower deploys, larger attack surface.

Multi-stage builds solve this with multiple `FROM` instructions in one Dockerfile. Each `FROM` starts a fresh stage; you `COPY --from=<stage>` only the artifacts you need into the final stage. Intermediate stages are discarded from the final image.

| Approach | Final image size | Build tools shipped? | Production-ready? |
|---|---|---|---|
| Single stage (`node` + serve) | ~400 MB | Yes (npm, node_modules) | Meh |
| Multi-stage (node → nginx) | ~45 MB | No | ✅ Yes |

### `.dockerignore` — the unsung hero

Everything in your project folder is sent to the Docker daemon as the **build context**. Without `.dockerignore`, you ship `node_modules`, `.git`, and old `dist` folders into every build — slow and cache-breaking. *Iska matlab ye hai ke* — a good `.dockerignore` is free build speed.

```text
node_modules
dist
.git
.env
*.log
```

### `ARG` vs `ENV` — build-time vs run-time config

This confuses everyone, so let's settle it:

| | `ARG` | `ENV` |
|---|---|---|
| Set via | `--build-arg` at build time | `ENV` in Dockerfile or `-e` at run time |
| Visible in | Build only | Build + running container |
| Use for | API URLs, version numbers baked into the build | Runtime config like `PORT`, `NODE_ENV` |

For a Vite React app, the API URL **must** be known at build time, because Vite bakes `import.meta.env.VITE_API_URL` into the compiled JS. That's why we pass it as a build arg. *Iska matlab ye hai ke* — frontend env vars are frozen at `docker build`, not `docker run`. If your API URL changes, you rebuild the image.

> ⚠️ Vite only exposes variables prefixed with `VITE_` to your app code. `API_URL` alone will be `undefined` in the browser — a classic gotcha.

### nginx `try_files` and SPA routing

React Router (and friends) do **client-side** routing: `/dashboard` doesn't exist as a file on the server. Without special config, nginx returns `404` when you refresh on that URL. The fix:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Translation: "try the exact file, then the directory, otherwise serve `index.html` and let React Router figure out the route." *Iska matlab ye hai ke* — every unknown path falls back to your app instead of a 404 page.

## 💻 Hands-On Lab

We will scaffold a real Vite React app, containerize it with a multi-stage Dockerfile, and serve it on nginx — all inside Docker (no local Node needed).

### Step 1 — Verify Docker is ready

```bash
docker --version
docker info --format '{{.ServerVersion}}'
```

✅ **Expected result:** version numbers print with no errors.

### Step 2 — Scaffold a Vite React app (inside a throwaway Node container)

```bash
mkdir -p ~/docker360/week5 && cd ~/docker360/week5
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm create vite@latest frontend -- --template react"
cd frontend
ls
```

✅ **Expected result:** `ls` shows `package.json`, `src/`, `index.html`, `vite.config.js` — a fresh React app, and you never installed Node locally.

### Step 3 — Add an API URL usage to the app (so build args mean something)

Open `src/App.jsx` and add one line near the top of the component:

```jsx
<p>API URL: {import.meta.env.VITE_API_URL || "not set"}</p>
```

*Iska matlab ye hai ke* — when we build with `--build-arg VITE_API_URL=...`, this value gets baked into the page.

### Step 4 — Create the `.dockerignore`

Create `frontend/.dockerignore`:

```text
node_modules
dist
.git
.env
*.log
```

### Step 5 — Create the custom nginx config (SPA fallback)

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback: let React Router handle unknown routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Step 6 — Write the multi-stage Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Build-time API URL (baked into the JS bundle by Vite)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Install deps first → better layer caching
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Notice the layer order: `COPY package*.json` + `npm ci` happens **before** `COPY . .`, so dependency installation is cached unless your dependencies change. *Iska matlab ye hai ke* — code edits rebuild in seconds instead of minutes.

### Step 7 — Build the image with a build arg

```bash
docker build --build-arg VITE_API_URL=https://api.example.com -t react-frontend:1.0 .
```

✅ **Expected result:** final lines show `writing image sha256:...` and `naming to docker.io/library/react-frontend:1.0`.

### Step 8 — Compare the size (the multi-stage payoff)

```bash
docker images react-frontend --format '{{.Repository}}:{{.Tag}}  {{.Size}}'
```

✅ **Expected result:** roughly **40–60 MB**. A single-stage Node image of the same app would be 400+ MB.

### Step 9 — Run it and test

```bash
docker run -d --name web -p 8080:80 react-frontend:1.0
curl -s http://localhost:8080 | grep -o "API URL: [^<]*"
```

✅ **Expected result:** `API URL: https://api.example.com` — the build arg made it into the bundle.

### Step 10 — Prove the SPA fallback works

```bash
# A route that exists only in React Router (no real file):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/dashboard
curl -s http://localhost:8080/dashboard | grep -o "<title>[^<]*</title>"
```

✅ **Expected result:** HTTP **200** (not 404) and the app's `<title>` — nginx served `index.html` as the fallback.

### Step 11 — Clean up

```bash
docker stop web && docker rm web
```

## ✅ Checkpoint

**Q1: Why use a multi-stage Dockerfile for a React app instead of serving from the Node image?**
A1: The Node stage is only needed to compile the app. The final nginx stage contains just static files (~45 MB), so the image is smaller, faster to deploy, and has a smaller attack surface.

**Q2: What's the difference between `ARG` and `ENV` in a Dockerfile?**
A2: `ARG` is set with `--build-arg` and exists only during the build; `ENV` persists into the running container and can be overridden with `-e` at run time.

**Q3: Why does refreshing on `/dashboard` give a 404 without the nginx `try_files` fix?**
A3: Because `/dashboard` is a client-side React Router route — no such file exists on the server. `try_files $uri $uri/ /index.html` falls back to `index.html` so the router can render the page.

**Q4: Your Vite app shows `VITE_API_URL` as `undefined` in the browser even though you passed `-e VITE_API_URL=...` to `docker run`. Why?**
A4: Vite bakes env vars into the JS bundle at **build time**. You must pass it as `--build-arg` during `docker build`; runtime `-e` flags can't change already-compiled static files.

## 🔜 Next Week

Week 6: we flip to the backend — containerizing a Node.js API the production way, with non-root users, graceful shutdowns, and health checks.
