---
author: Rao Shahzaib
pubDatetime: 2026-10-02T10:00:00Z
title: "Week 7: PostgreSQL in Production with Docker"
description: "Run PostgreSQL like a pro in Docker: official image config, init scripts, named volumes for data, pg_dump backup and restore drills, and app connection patterns."
tags: ["docker", "docker-360", "postgres", "database"]
---

> 🐳 **Docker 360 — Week 7 of 16** | Stateful services done right: Postgres in Docker

## 🎯 Learning Objective

By the end of this week, you will be able to run PostgreSQL in Docker the production way: configure it with `POSTGRES_*` variables, seed databases with `/docker-entrypoint-initdb.d` init scripts, persist data on named volumes, and perform real backup/restore drills with `pg_dump`. *Iska matlab ye hai ke* — your database will survive container restarts, rebuilds, and bad Mondays.

## 🎨 Visual Diagrams

### Where Postgres keeps its data (and why volumes matter)

```text
 WITHOUT a volume (data dies with the container):

 ┌─────────────────────────┐
 │  postgres container     │
 │   /var/lib/postgresql/  │
 │        data/  ◀── lives in the container's writable layer
 └─────────────────────────┘
        docker rm pg  ──▶  💥 DATA GONE FOREVER

 WITH a named volume (data outlives the container):

 ┌─────────────────────────┐        ┌──────────────────┐
 │  postgres container     │        │  named volume    │
 │   /var/lib/postgresql/  │───────▶│  "pgdata"        │
 │        data/  (mount)   │        │  (managed by     │
 └─────────────────────────┘        │   Docker, on disk)│
        docker rm pg  ──▶  ✅ DATA SAFE → attach to a new container
```

### Init scripts: first-boot seeding

```text
 FIRST EVER start (empty /var/lib/postgresql/data):

   postgres image boots
        │
        ▼
   ┌──────────────────────────────────────────┐
   │ /docker-entrypoint-initdb.d/             │
   │   01-schema.sql   ──▶ runs (alphabetical)│
   │   02-seed.sql     ──▶ runs               │
   │   03-setup.sh     ──▶ runs               │
   └──────────────────────────────────────────┘
        │
        ▼
   database ready with schema + seed data ✅

 SECOND start (volume already has data):

   init scripts are SKIPPED entirely ⚠️
   (iska matlab: ye sirf pehli dafa chalte hain!)
```

### App → Postgres connection on a user-defined network

```text
 ┌──────────────┐                    ┌──────────────┐
 │  api         │   postgres://      │  pg          │
 │  container   │ ─────────────────▶ │  container   │
 │              │   hostname = "pg"  │  :5432       │
 └──────────────┘   (container name  └──────────────┘
        │            = DNS name!)            ▲
        └──────── appnet (user-defined) ─────┘
              automatic DNS resolution ✅
```

*Iska matlab ye hai ke* — on a user-defined network, containers find each other by name. No hardcoded IPs, no `--link` hacks.

## 🧠 Theory Deep Dive

### The official image's contract: `POSTGRES_*` variables

The `postgres` image refuses to start without a password decision — a deliberate safety default:

| Variable | Purpose | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | Superuser password | **Required** (or use `_FILE` variant / trust mode) |
| `POSTGRES_USER` | Superuser name | Default: `postgres` |
| `POSTGRES_DB` | Database created at init | Default: same as `POSTGRES_USER` |
| `POSTGRES_INITDB_ARGS` | Extra `initdb` flags | e.g. `--auth-host=scram-sha-256` |

> 🔐 Production tip: use `POSTGRES_PASSWORD_FILE=/run/secrets/pg_password` with Docker secrets instead of plain env vars — env values are visible in `docker inspect`.

### Init scripts run once — design accordingly

Files in `/docker-entrypoint-initdb.d/` (`.sql`, `.sql.gz`, `.sh`) execute **only when the data directory is empty**. Make them idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`) so re-runs never explode. For schema changes on an *existing* database, init scripts are the wrong tool — use a migration tool (Flyway, Prisma Migrate, Alembic) instead.

### Tuning without rebuilding: `-c` flags

You don't need a custom `postgresql.conf` for simple tuning — append `-c` options after the image name:

```bash
docker run ... postgres:17 -c max_connections=200 -c shared_buffers=256MB
```

For heavier customization, mount your own config: `-v ./postgresql.conf:/etc/postgresql/postgresql.conf -c config_file=/etc/postgresql/postgresql.conf`.

### Backup strategy: `pg_dump` basics

| Method | What it backs up | Restore with |
|---|---|---|
| `pg_dump dbname` | One database (schema + data, SQL text) | `psql` |
| `pg_dump -Fc dbname` | One database (custom compressed format) | `pg_restore` |
| `pg_dumpall` | All databases + roles | `psql` |

*Iska matlab ye hai ke* — `pg_dump` doesn't back up the *server config* or roles (unless `pg_dumpall`). For a full disaster-recovery story, back up the volume too.

## 💻 Hands-On Lab

### Part A — Run Postgres properly

#### Step 1 — Create a network and a named volume

```bash
docker network create appnet
docker volume create pgdata
```

#### Step 2 — Prepare init scripts

```bash
mkdir -p ~/docker360/week7/initdb && cd ~/docker360/week7
cat > initdb/01-schema.sql <<'EOF'
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT 'docker-360'
);
EOF
cat > initdb/02-seed.sql <<'EOF'
INSERT INTO students (name, course) VALUES
  ('Ali', 'docker-360'),
  ('Sana', 'docker-360')
ON CONFLICT DO NOTHING;
EOF
ls initdb/
```

#### Step 3 — Start Postgres with init scripts mounted

```bash
docker run -d --name pg \
  --network appnet \
  -e POSTGRES_USER=appuser \
  -e POSTGRES_PASSWORD='Str0ng!Pass' \
  -e POSTGRES_DB=appdb \
  -v pgdata:/var/lib/postgresql/data \
  -v "$PWD/initdb":/docker-entrypoint-initdb.d:ro \
  postgres:17
sleep 5
docker logs pg --tail 8
```

✅ **Expected result:** logs show `database system is ready to accept connections` and lines about executing the init files.

#### Step 4 — Verify the seed data

```bash
docker exec -it pg psql -U appuser -d appdb -c "TABLE students;"
```

✅ **Expected result:**

```text
 id | name |  course
----+------+-----------
  1 | Ali  | docker-360
  2 | Sana | docker-360
```

*Iska matlab ye hai ke* — the init scripts ran exactly once on first boot and seeded your database.

### Part B — Prove the volume survives

#### Step 5 — Delete the container, keep the volume, start fresh

```bash
docker stop pg && docker rm pg
# NOTE: we do NOT remove the pgdata volume!
docker run -d --name pg2 \
  --network appnet \
  -e POSTGRES_USER=appuser \
  -e POSTGRES_PASSWORD='Str0ng!Pass' \
  -e POSTGRES_DB=appdb \
  -v pgdata:/var/lib/postgresql/data \
  postgres:17
sleep 5
docker exec pg2 psql -U appuser -d appdb -tAc "SELECT count(*) FROM students;"
```

✅ **Expected result:** `2` — the data survived the container's death because it lives in the volume, not the container.

> ⚠️ Try starting `pg2` **without** `-v pgdata:...` once and re-running the count — you'll get an error that the table doesn't exist. That's the lesson, burned into memory.

### Part C — Backup and restore drill

#### Step 6 — Take a backup with pg_dump

```bash
docker exec pg2 pg_dump -U appuser appdb > ~/docker360/week7/appdb-backup.sql
ls -lh ~/docker360/week7/appdb-backup.sql
head -20 ~/docker360/week7/appdb-backup.sql
```

✅ **Expected result:** a SQL file (a few KB) starting with PostgreSQL dump header comments.

#### Step 7 — Simulate disaster and restore

```bash
# Disaster: drop the table
docker exec pg2 psql -U appuser -d appdb -c "DROP TABLE students;"
docker exec pg2 psql -U appuser -d appdb -c "TABLE students;"  # → ERROR, table gone

# Restore from backup
cat ~/docker360/week7/appdb-backup.sql | docker exec -i pg2 psql -U appuser -d appdb
docker exec pg2 psql -U appuser -d appdb -tAc "SELECT count(*) FROM students;"
```

✅ **Expected result:** after restore, the count is `2` again. *Iska matlab ye hai ke* — you just survived a (simulated) disaster with a one-line backup and a one-line restore. Schedule this with cron in real life.

### Part D — Connect an app container

#### Step 8 — Verify DNS-by-name from a client container

```bash
docker run --rm --network appnet postgres:17 \
  psql "postgres://appuser:Str0ng!Pass@pg2:5432/appdb" -tAc "SELECT 'connected via hostname pg2 ✅';"
```

✅ **Expected result:** `connected via hostname pg2 ✅` — the hostname is just the container name. In your app code, the connection string is `postgres://appuser:<pass>@pg2:5432/appdb`.

### Step 9 — Clean up

```bash
docker stop pg2 && docker rm pg2
docker volume rm pgdata
docker network rm appnet
```

## ✅ Checkpoint

**Q1: You restart your Postgres container and the init scripts don't run again. Is something broken?**
A1: No — that's by design. `/docker-entrypoint-initdb.d` scripts run only when the data directory is empty (first init). On restarts with existing data they're skipped.

**Q2: Your container was removed with `docker rm` but the volume still exists. Is your data safe?**
A2: Yes. Data in a named volume lives outside the container's filesystem. Attach the same volume to a new container and everything is back.

**Q3: How does an app container reach Postgres — IP address or something else?**
A3: By container name as hostname (e.g. `pg2:5432`) on a shared user-defined network, which gives automatic DNS resolution. Never hardcode container IPs — they change.

**Q4: What's the difference between `pg_dump` and `pg_dumpall`?**
A4: `pg_dump` backs up a single database; `pg_dumpall` backs up the whole cluster including all databases, roles, and global objects. Use `pg_dumpall` (or volume backups) for full disaster recovery.

## 🔜 Next Week

Week 8: automation time — build a real CI/CD pipeline with GitHub Actions: lint, build, scan, push to GHCR, and deploy with Compose.
