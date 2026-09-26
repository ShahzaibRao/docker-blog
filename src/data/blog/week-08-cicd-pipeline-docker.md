---
author: Rao Shahzaib
pubDatetime: 2026-09-18T00:00:00Z
title: "Week 8: CI/CD Pipeline for Docker Apps"
description: "Build a complete GitHub Actions CI/CD pipeline for Docker: lint with Hadolint, build, Trivy security scan, push to GHCR with smart tagging, and deploy via Compose."
tags: ["docker", "docker-360", "cicd", "github-actions"]
---

> 🐳 **Docker 360 — Week 8 of 16** | From `git push` to production, automatically

## 🎯 Learning Objective

By the end of this week, you will be able to build a complete CI/CD pipeline with GitHub Actions that lints your Dockerfile, builds the image, scans it for vulnerabilities with Trivy, pushes it to GitHub Container Registry (GHCR) with a smart tagging strategy, and deploys it to a server with Docker Compose. *Iska matlab ye hai ke* — every push to `main` becomes a tested, scanned, deployed release with zero manual steps.

## 🎨 Visual Diagrams

### The pipeline: push → prod

```text
 git push (main)
      │
      ▼
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │  1. LINT     │──▶│  2. BUILD    │──▶│  3. SCAN     │──▶│  4. PUSH     │
 │  Hadolint    │   │  buildx      │   │  Trivy       │   │  GHCR        │
 │  Dockerfile  │   │  multi-arch? │   │  CRITICAL/   │   │  sha, semver │
 │  best        │   │  layer cache │   │  HIGH → fail │   │  latest      │
 │  practices   │   │              │   │              │   │              │
 └──────────────�ulcorner──────────┘   └──────────────┘   └──────┬───────┘
   ❌ fail fast: bad Dockerfile                                  │
      never builds                                              ▼
                                                        ┌──────────────┐
                                                        │  5. DEPLOY   │
                                                        │  SSH → server│
                                                        │  compose pull│
                                                        │  && up -d    │
                                                        └──────────────┘
```

### Tagging strategy: which tag for what

```text
 Event                    Tags applied                    Purpose
 ─────────────────────    ─────────────────────────────   ──────────────────
 push to main             sha-7f3a2c1, latest             traceable + "current"
 git tag v1.2.3           1.2.3, 1.2, 1, latest           semver release
 pull request             pr-42 (no push)                 test build only
```

*Iska matlab ye hai ke* — `latest` is for convenience, the **sha tag is for truth** (exactly which commit is running?), and **semver tags are for releases** humans can reason about.

### GHCR: where images live

```text
 GitHub repo: ShahzaibRao/docker-blog
        │  docker/build-push-action (GITHUB_TOKEN, packages: write)
        ▼
 ghcr.io/shahzaibrao/docker-blog:sha-7f3a2c1   ◀── lowercase! registry
 ghcr.io/shahzaibrao/docker-blog:latest           names must be lowercase
        │
        ▼  docker compose pull  (on your server)
```

> ⚠️ GHCR image names **must be lowercase** — `docker/metadata-action` handles this automatically from `github.repository`.

## 🧠 Theory Deep Dive

### Stage 1 — Lint: fail fast with Hadolint

Hadolint checks your Dockerfile against best practices (pin versions, no `latest`, `COPY` before `RUN`, etc.) *before* you waste minutes building. Catching `FROM node:latest` in CI is infinitely cheaper than debugging a broken prod deploy at 2 AM.

### Stage 2 — Build: `buildx` and layer caching

`docker/setup-buildx-action` enables BuildKit, which gives you faster parallel builds and cache exports. In CI, pair it with the GitHub Actions cache so unchanged layers are reused across runs:

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

*Iska matlab ye hai ke* — your 5-minute build becomes a 40-second build after the first run.

### Stage 3 — Scan: Trivy as a quality gate

Trivy scans the final image for OS and dependency CVEs. The key decision: **which severities fail the build?** A common production policy:

| Severity | Action |
|---|---|
| CRITICAL, HIGH | ❌ Fail the pipeline |
| MEDIUM, LOW | ⚠️ Report only |

Upload results as SARIF and they appear in GitHub's **Security tab** — free vulnerability dashboard.

### Stage 4 — Push: metadata-action tagging

Hand-writing tag logic in bash is error-prone. `docker/metadata-action` generates tags from events:

```yaml
tags: |
  type=sha                          # sha-7f3a2c1
  type=ref,event=tag                 # 1.2.3 from git tag
  type=raw,value=latest,enable={{is_default_branch}}
```

### Stage 5 — Deploy: Compose pull + up

The server doesn't rebuild — it **pulls** the exact image CI just pushed and recreates containers. `docker compose up -d` is idempotent: unchanged services are left alone, changed ones get the new image with a rolling recreate. Old images are pruned so the disk doesn't fill up.

## 💻 Hands-On Lab

We'll add this pipeline to a real repo (use your `docker-blog` repo or any repo with a Dockerfile). You need a GitHub repo + (for the deploy job) a Linux server with Docker and SSH access.

### Step 1 — Check your repo has a Dockerfile

```bash
git clone https://github.com/ShahzaibRao/docker-blog.git ~/docker360/week8-cicd
cd ~/docker360/week8-cicd
ls Dockerfile
```

### Step 2 — Create the workflow file

Create `.github/workflows/docker-pipeline.yml`:

```yaml
name: Docker CI/CD

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io

jobs:
  # ── 1. LINT ──────────────────────────────────────────────
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint Dockerfile
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile
          failure-threshold: error

  # ── 2. BUILD → 3. SCAN → 4. PUSH ─────────────────────────
  build-scan-push:
    needs: lint
    runs-on: ubuntu-latest
    # Skip push on PRs, but still build+scan
    permissions:
      contents: read
      packages: write
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate tags
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,prefix=sha-
            type=ref,event=tag
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image with Trivy
        uses: aquasecurity/trivy-action@0.24.0
        with:
          image-ref: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: "1" # fail the job on CRITICAL/HIGH

      - name: Upload scan results to Security tab
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif

  # ── 5. DEPLOY ───────────────────────────────────────────
  deploy:
    needs: build-scan-push
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH + Compose
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            set -e
            cd /opt/myapp
            echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -af --filter "until=72h"
            docker compose ps
```

### Step 3 — Understand the moving parts (read before pushing!)

| Secret / setting | Where to set it | Purpose |
|---|---|---|
| `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY` | Repo → Settings → Secrets → Actions | Deploy job SSH access |
| `GITHUB_TOKEN` | Automatic | GHCR login (needs `packages: write`) |
| `/opt/myapp/compose.yaml` | On your server | Must reference `image: ghcr.io/<you>/<repo>:latest` |
| GHCR package visibility | Package settings | Set to **Public** or grant access, else `pull` fails |

*Iska matlab ye hai ke* — the pipeline is complete, but deployment needs these three secrets plus a compose file on the server pointing at the GHCR image. No secrets, no deploy — and that's a feature, not a bug.

### Step 4 — Commit and push, then watch it run

```bash
git add .github/workflows/docker-pipeline.yml
git commit -m "Add Docker CI/CD pipeline: lint, build, scan, push, deploy"
git push origin main
```

Then open **Actions** tab in your repo.

✅ **Expected result:** the `lint` job goes green, `build-scan-push` builds the image, Trivy scans it, and the image appears under your profile → **Packages** as `ghcr.io/<you>/<repo>:sha-<sha>` and `:latest`.

### Step 5 — Verify the image and its tags

```bash
# Pull the exact sha-tagged image CI built — traceable to your commit
docker pull ghcr.io/shahzaibrao/docker-blog:sha-$(git rev-parse --short HEAD)
docker images ghcr.io/shahzaibrao/docker-blog --format '{{.Tag}}'
```

✅ **Expected result:** both the `sha-xxxxxxx` and `latest` tags exist. You can now answer "exactly which commit is running in prod?" with the sha tag.

### Step 6 — Cut a semver release (optional but satisfying)

```bash
git tag v1.0.0 && git push origin v1.0.0
```

✅ **Expected result:** the pipeline runs again and produces `1.0.0`, `1.0`, `1`, and `latest` tags — the full semver set, automatically.

## ✅ Checkpoint

**Q1: Why does the pipeline lint the Dockerfile before building?**
A1: To fail fast. Hadolint catches best-practice violations (unpinned versions, `latest` tags, etc.) in seconds, before spending minutes on a build that would produce a bad image anyway.

**Q2: Why do we need three tag types (sha, semver, latest) instead of just `latest`?**
A2: `latest` is convenient but not traceable — you can't tell which commit it is. The sha tag maps 1:1 to a commit (auditability), semver tags mark human-meaningful releases, and `latest` is just a moving pointer for convenience.

**Q3: What does `exit-code: "1"` on the Trivy step do, and why limit it to CRITICAL/HIGH?**
A3: It fails the pipeline when CRITICAL or HIGH vulnerabilities are found — a security quality gate. Limiting to those severities avoids blocking every deploy on low-risk findings while still catching the dangerous ones.

**Q4: Why does the deploy job run `docker compose pull` instead of rebuilding on the server?**
A4: Because CI already built, scanned, and pushed the exact image. Pulling guarantees the server runs the identical tested artifact — rebuilding on the server could produce a different image and skips the security scan.

## 🔜 Next Week

Week 9: Compose in depth — multi-service apps, networks, and profiles, wiring Weeks 5–7 together into one stack.
