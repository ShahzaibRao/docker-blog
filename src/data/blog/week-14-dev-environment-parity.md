---
author: Rao Shahzaib
pubDatetime: 2026-10-09T10:00:00Z
title: "Week 14: Team Dev Environments & Parity"
description: "Give every developer the same stack: Docker Compose override files for dev vs prod, live code reload with volumes, seeded databases, and a team workflow that just works."
tags: ["docker", "docker-360", "dev-environment", "compose"]
---

> 🐳 **Docker 360 — Week 14 of 16** | Same stack for every developer

## 🎯 Learning Objective

"Meray laptop par to chal raha tha!" — ye jumla har team ne suna hai. Is week me tum seekhoge ke Docker Compose **override files** se dev aur prod configs ko kaise alag rakha jaye, **volumes** se live code reload kaise mile, **seed scripts** se har developer ko same database data kaise mile, aur poori team ke liye ek repeatable workflow kaise banaya jaye. End tak tumhare paas ek aisa template hoga jo naye team member ko pehle din se productive bana de.

## 🎨 Visual Diagrams

**Override files ka merge concept:**

```text
  docker-compose.yml            docker-compose.override.yml
  (BASE — sab ke liye)          (DEV ONLY — auto-merge hoti hai)
  ┌─────────────────────┐       ┌──────────────────────────────┐
  │ services:           │       │ services:                    │
  │   web:              │       │   web:                       │
  │     build: .        │  +    │     volumes:                 │
  │     ports:          │       │       - .:/app      (live    │
  │       - 8000:8000   │       │     command: uvicorn         │
  │   db:               │       │       --reload     code!)    │
  │     image: pg:16     │       │     environment:             │
  └─────────────────────┘       │       - DEBUG=1              │
                                └──────────────────────────────┘
              │  docker compose up  (dono auto-merge!)
              ▼
  ┌──────────────────────────────────────────────────┐
  │  FINAL CONFIG                                    │
  │   web: build + ports + volumes + reload + DEBUG  │
  │   db:  postgres 16                               │
  └──────────────────────────────────────────────────┘

  PROD me override ko SKIP karo:
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**Team workflow — sab ke paas same stack:**

```text
  Developer A (Linux) ─┐
                       │
  Developer B (Mac) ───┼──►  git clone → cp .env.example .env → docker compose up
                       │                    │
  Developer C (Win) ───┘                     ▼
                                    ┌───────────────┐
                                    │ web  (reload) │
                                    │ db   (seeded) │  ◄── same everywhere ✓
                                    │ cache (redis) │
                                    └───────────────┘
```

## 🧠 Theory Deep Dive

### Override files kaise kaam karti hain?

Jab tum `docker compose up` chalate ho, Compose **khud ba khud** in files ko merge kar deti hai (agar mojood hon):

1. `docker-compose.yml` (ya `compose.yaml`) — base config
2. `docker-compose.override.yml` — dev-specific changes

Merge **deep** hota hai: mappings (jaise `environment`) merge hote hain, jabke sequences (jaise `ports`) replace ho jati hain. Iska matlab ye hai ke base file me production jaisi clean config rakho, aur dev wali cheezen (bind mounts, debug flags, reload commands) override me.

Prod deploy ke waqt override ko explicitly skip karo:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Volume sync strategies

| Strategy | Kya hai | Kab use karo |
|---|---|---|
| Bind mount (`.:/app`) | Host ka code container me live | Dev me code reload ke liye |
| Named volume for deps (`/app/node_modules`) | Container ki installed deps ko bind mount se bachana | Node/Python projects me |
| `.dockerignore` | Build context se junk bahar | Hamesha — tez builds ke liye |
| Named volume for DB (`pgdata:/var/lib/postgresql/data`) | Data container delete hone par bhi rahe | Dev databases ke liye |

**Classic Node trick** — bind mount host ke `node_modules` ko overwrite na kare:

```yaml
services:
  web:
    volumes:
      - .:/app
      - /app/node_modules   # anonymous volume: container wali deps mehfooz
```

Iska matlab ye hai ke host par `node_modules` mojood ho ya na ho, container apni installed dependencies use karega.

### Database seed scripts

Postgres image `/docker-entrypoint-initdb.d/` me rakhi `.sql` aur `.sh` files ko **pehli dafa** (jab data volume khaali ho) automatically chala deti hai:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: devdb
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
```

Numbering (`01-schema.sql`, `02-seed.sql`) se order control hota hai. Har developer ko same schema + same sample data — parity ka yehi matlab hai.

### Healthcheck + seed container pattern

Agar seed logic complex ho (API calls, etc.), ek one-shot container banao jo DB ke healthy hone ka wait kare:

```yaml
services:
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev -d devdb"]
      interval: 5s
      retries: 10
  seed:
    build: .
    depends_on:
      db:
        condition: service_healthy
    command: python /app/seed.py
```

## 💻 Hands-On Lab

Ek complete dev stack banate hain: FastAPI app (live reload) + seeded Postgres.

### Lab 1 — Project setup

**Step 1:** Project structure banao:

```bash
mkdir -p /tmp/team-stack/app /tmp/team-stack/db/init && cd /tmp/team-stack
```

**Step 2:** `app/main.py` likho:

```python
from fastapi import FastAPI
import socket

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Hello from the team stack!", "served_by": socket.gethostname()}

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 3:** `app/requirements.txt`:

```text
fastapi
uvicorn[standard]
psycopg2-binary
```

**Step 4:** `Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Step 5:** `db/init/01-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL
);
```

**Step 6:** `db/init/02-seed.sql`:

```sql
INSERT INTO users (name, role) VALUES
  ('Ali', 'developer'),
  ('Sara', 'designer'),
  ('Ahmed', 'devops')
ON CONFLICT DO NOTHING;
```

### Lab 2 — Base + override compose files

**Step 7:** `docker-compose.yml` (base — prod jaisi clean config):

```yaml
services:
  web:
    build: .
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: devdb
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev -d devdb"]
      interval: 5s
      retries: 10

volumes:
  pgdata:
```

**Step 8:** `docker-compose.override.yml` (sirf dev ke liye):

```yaml
services:
  web:
    volumes:
      - ./app:/app        # live code reload
    environment:
      - DEBUG=1
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Step 9:** `.env.example` (team me commit hoti hai) aur `.dockerignore`:

```bash
# .env.example — copy karke .env banao, .env ko git me mat dalo
cat > .env.example <<'EOF'
POSTGRES_USER=dev
POSTGRES_PASSWORD=devpass
POSTGRES_DB=devdb
EOF
cp .env.example .env

cat > .dockerignore <<'EOF'
.git
__pycache__
*.pyc
.env
EOF
```

**Step 10:** Stack up karo:

```bash
docker compose up --build -d
sleep 8
curl -s localhost:8000/
```

✅ **Expected result:** `{"message":"Hello from the team stack!",...}` — app chal rahi hai.

### Lab 3 — Live reload ka magic

**Step 11:** Code edit karo **bina rebuild** ke:

```bash
sed -i 's/Hello from the team stack!/Hello TEAM - edited live!/' app/main.py
sleep 3
curl -s localhost:8000/
```

✅ **Expected result:** Naya message foran nazar aayega — `--reload` ne file change detect karke server restart kar diya. Iska matlab ye hai ke dev loop seconds ka hai, minutes ka nahi.

### Lab 4 — Seeded data verify karo

**Step 12:**

```bash
docker compose exec db psql -U dev -d devdb -c "SELECT * FROM users;"
```

✅ **Expected result:** Ali, Sara, Ahmed wali 3 rows — har developer ke paas yehi data hoga, chahe wo duniya ke kisi kone me ho.

### Lab 5 — Override merge ko inspect karo

**Step 13:**

```bash
docker compose config --services
docker compose config | grep -A5 'command:'
```

✅ **Expected result:** Merge hui final config me `command: uvicorn ... --reload` aur volume mount dono nazar aayenge — proof ke override apply hui.

**Step 14:** Prod-style run (override skip):

```bash
docker compose -f docker-compose.yml up -d --force-recreate
docker compose exec web ps aux | grep -c "[u]vicorn"
docker compose down -v
```

✅ **Expected result:** Prod mode me `--reload` nahi chalega — sirf base config active hogi. (Demo ke baad `down -v` se safai.)

## ✅ Checkpoint

**Q1: `docker compose up` chalane par kaunsi files auto-merge hoti hain?**
A: `docker-compose.yml` (base) aur `docker-compose.override.yml` (agar mojood ho) — override dev-specific changes ke liye hoti hai.

**Q2: Bind mount ke sath Node project me `/app/node_modules` anonymous volume kyun lagate hain?**
A: Taake host ka (ya missing) `node_modules` folder container ki installed dependencies ko overwrite na kar de.

**Q3: Postgres seed scripts kab chalti hain — har restart par ya sirf pehli dafa?**
A: Sirf pehli dafa, jab data volume khaali ho. Isi liye seed change karne ke baad volume delete karna parhta hai.

**Q4: Naye team member ke liye ideal onboarding steps kya honge is setup me?**
A: `git clone`, `cp .env.example .env`, `docker compose up` — bas. Koi "pehle ye install karo, phir wo version set karo" wali kahani nahi.

## 🔜 Next Week

Week 15 me hum **GPUs ko containers me** layenge aur **MLflow** se experiments track karenge — ML workloads ka Docker wala hissa! ⏭️
