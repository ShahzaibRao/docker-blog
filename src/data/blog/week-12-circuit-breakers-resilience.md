---
author: Rao Shahzaib
pubDatetime: 2026-09-22T00:00:00Z
title: "Week 12: Resilience Patterns — Circuit Breakers"
description: "Learn retries, timeouts, bulkheads and the circuit breaker pattern (closed/open/half-open), then build a two-container lab with a flaky service and a Python client that fails gracefully."
tags: ["docker", "docker-360", "resilience", "microservices"]
---

> 🐳 **Docker 360 — Week 12 of 16** | Resilience patterns — circuit breakers that fail gracefully

## 🎯 Learning Objective

By the end of this week, you will understand why distributed systems **must expect failure** — and how **retries, timeouts, bulkheads and circuit breakers** keep one dying service from taking down everything. Then you will build a real two-container lab: a **flaky service** that randomly fails, and a **Python client with a circuit breaker** that detects the failure, stops hammering, and recovers gracefully.

## 🎨 Visual Diagrams

**Without a breaker — one slow service kills everyone (retry storm):**

```text
  client ──retry──▶ ┌──────────────┐
         ──retry──▶ │ flaky service│  ◀── every client retries
         ──retry──▶ │ (struggling) │      at once = retry storm
         ──retry──▶ └──────────────┘      service never recovers
  threads pile up → client runs out of memory → client dies too 💥
```

**With a breaker — fail fast, recover smart:**

```text
  client ──▶ ┌─────────────────┐ ──▶ ┌──────────────┐
             │ CIRCUIT BREAKER │      │ flaky service│
             │  CLOSED: let it │ ──▶  │              │
             │  flow, count    │      └──────────────┘
             │  failures       │
             │  OPEN: fail     │ ──✖  (don't even call —
             │  FAST, no call  │      give it breathing room)
             │  HALF-OPEN:     │ ──▶  (one probe: recovered?)
             │  send 1 probe   │
             └─────────────────┘
```

**Circuit breaker state machine:**

```text
                    failures ≥ threshold
              ┌──────────────────────────────┐
              │                              ▼
        ┌───────────┐                  ┌───────────┐
        │  CLOSED   │                  │   OPEN    │
        │ requests  │                  │ fail fast │
        │ flow      │                  │ (no calls)│
        └─────┬─────┘                  └─────┬─────┘
              │ success resets         │ recovery timeout
              │ failure count          │ expires
              │                        ▼
              │                  ┌───────────┐
              │                  │ HALF-OPEN │
              │                  │ 1 probe   │
              │                  └─────┬─────┘
              │               success ┌┴─────┐ failure
              └───────────────────────┘      └────────▶ (back to OPEN)
```

## 🧠 Theory Deep Dive

### Pehla usool: failure is normal

Monolith me function call kabhi "network timeout" nahi deta. Microservices me **har call ek network call hai** — aur network *will* fail: service slow hogi, container restart hoga, deploy ke doraan 500 aayenge. *Iska matlab ye hai ke* resilience optional feature nahi — ye distributed system ka admission ticket hai.

### The resilience toolbox

| Pattern | Kya karta hai | Roman Urdu me |
|---|---|---|
| **Timeout** | Har call ki deadline — "2 sec me jawab nahi to chor do" | Intezaar ki limit |
| **Retry** | Fail hone pe dobara try — **backoff + jitter** ke saath | "Ek baar phir try karo, thora ruk ke" |
| **Bulkhead** | Resources alag rakho — ek slow dependency saare threads na kha jaye | Jahaz ke compartments jaisa — ek me paani, baqi mehfooz |
| **Circuit breaker** | Lagatar failures pe calls rok do, waqfe se ek probe bhejo | Bijli ka breaker — trip karo, phir check karo |

### Retries — powerful but dangerous

Retry sab se aasaan pattern hai, lekin **soch ke use karo**:

- Hamesha **exponential backoff** (1s, 2s, 4s...) + **jitter** (random thora waqfa) — warna saare clients ek hi waqt pe retry karenge (*thundering herd*).
- Sirf **idempotent** operations pe retry karo — `GET` safe hai, `POST /charge-credit-card` dobara bhejna khatarnaak!
- Retry **budget** rakho — 3 tries bas, infinite nahi.

### Circuit breaker states — detail me

| State | Behavior | Kab enter hota hai |
|---|---|---|
| **CLOSED** | Requests normal flow; failures gino | Normal operation |
| **OPEN** | Calls ko foran reject karo ("fail fast") — downstream ko saans lene do | Failures ≥ threshold (e.g. 3 lagatar) |
| **HALF-OPEN** | Sirf **ek** probe request jaane do | Recovery timeout (e.g. 10s) guzar jaye |
| → CLOSED | Probe kamyab → sab normal | Service recover ho gayi 🎉 |
| → OPEN | Probe fail → wapas open | Abhi bhi bimaar, aur intezaar |

*Yahi woh pattern hai jo* Netflix, Amazon jaise systems me cascading failures rokta hai.

### Docker's first line of defense

Code-level patterns se pehle, Docker khud do cheezen deta hai:

- **HEALTHCHECK** — container ke andar command jo batata hai ke app *asal me* healthy hai ya sirf process chal raha hai.
- **Restart policies** (`unless-stopped`, `on-failure`) — crash hone pe container khud wapas aaye.

Ye infrastructure-level resilience hai; circuit breaker application-level. Dono mil ke kaam karte hain.

## 💻 Hands-On Lab

Hum 3 files banayenge: ek **flaky service** (jaanti hai ke kabhi kabhi fail hona hai 😈), ek **client** jisme circuit breaker logic hai, aur ek `docker-compose.yml`.

### Step 1 — Project structure

```bash
mkdir -p ~/cb-lab/flaky ~/cb-lab/client && cd ~/cb-lab
```

### Step 2 — The flaky service (fails ~60% of the time)

```bash
cat > flaky/server.py <<'EOF'
import random, time
from flask import Flask, jsonify

app = Flask(__name__)
FAIL_RATE = 0.6  # 60% requests fail — jaan boojh ke!

@app.get("/health")
def health():
    return jsonify(status="ok"), 200

@app.get("/api/data")
def data():
    time.sleep(0.2)
    if random.random() < FAIL_RATE:
        return jsonify(error="boom - downstream failure"), 500
    return jsonify(data="hello from flaky service"), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
EOF

cat > flaky/Dockerfile <<'EOF'
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir flask
COPY server.py .
CMD ["python", "server.py"]
EOF
```

### Step 3 — The client with a circuit breaker

```bash
cat > client/client.py <<'EOF'
import time, urllib.request, urllib.error

class CircuitBreaker:
    CLOSED, OPEN, HALF_OPEN = "CLOSED", "OPEN", "HALF_OPEN"

    def __init__(self, fail_threshold=3, recovery_timeout=10):
        self.state = self.CLOSED
        self.failures = 0
        self.fail_threshold = fail_threshold
        self.recovery_timeout = recovery_timeout
        self.opened_at = None

    def call(self, url):
        if self.state == self.OPEN:
            if time.time() - self.opened_at >= self.recovery_timeout:
                self.state = self.HALF_OPEN
                print("  [breaker] OPEN -> HALF-OPEN (ek probe bhej rahe hain...)")
            else:
                return "BLOCKED - open circuit ne fast-fail kiya"
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                body = r.read().decode()[:40]
            self._success()
            return f"OK: {body}"
        except Exception as e:
            self._failure()
            return f"FAIL: {type(e).__name__}"

    def _success(self):
        if self.state == self.HALF_OPEN:
            print("  [breaker] HALF-OPEN -> CLOSED (service recover ho gayi!)")
        self.state = self.CLOSED
        self.failures = 0

    def _failure(self):
        self.failures += 1
        if self.failures >= self.fail_threshold and self.state != self.OPEN:
            self.state = self.OPEN
            self.opened_at = time.time()
            print(f"  [breaker] -> OPEN (lagatar {self.failures} failures - TRIP!)")

breaker = CircuitBreaker()
for i in range(1, 41):
    result = breaker.call("http://flaky:5000/api/data")
    print(f"req {i:02d} [{breaker.state:9s}] {result}")
    time.sleep(1)
EOF

cat > client/Dockerfile <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY client.py .
CMD ["python", "client.py"]
EOF
```

*Dekho* — `call()` me timeout bhi hai (3s), failure counting bhi, aur teeno states bhi. Ye production breakers (resilience4j, Polly) ka chhota bhai hai.

### Step 4 — Compose file with healthcheck + restart policy

```bash
cat > docker-compose.yml <<'EOF'
services:
  flaky:
    build: ./flaky
    networks: [cbnet]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:5000/health', timeout=2)\""]
      interval: 10s
      timeout: 3s
      retries: 3

  client:
    build: ./client
    depends_on:
      - flaky
    networks: [cbnet]

networks:
  cbnet:
EOF
```

### Step 5 — Build and run

```bash
docker compose up --build -d
docker compose ps
```

> ✅ **Expected result:** Dono containers `Up`; `flaky` ke saamne `(healthy)` aana chahiye chand seconds me — healthcheck kaam kar raha hai!

### Step 6 — Watch the breaker trip 🔥

```bash
docker compose logs -f client
```

> ✅ **Expected result:** Shuru me `FAIL` aur `OK` mix nazar aayenge, phir:
> ```
> req 05 [CLOSED   ] FAIL: HTTPError
>   [breaker] -> OPEN (lagatar 3 failures - TRIP!)
> req 06 [OPEN     ] BLOCKED - open circuit ne fast-fail kiya
> req 07 [OPEN     ] BLOCKED - open circuit ne fast-fail kiya
> ...
>   [breaker] OPEN -> HALF-OPEN (ek probe bhej rahe hain...)
> ```
> *Yahi circuit breaker hai* — 3 lagatar failures pe usne downstream ko marna **band** kar diya aur fast-fail karne laga. Bina breaker ke ye client retry storm me phans jata!

### Step 7 — Chaos test: kill the service, watch recovery 🧪

```bash
# Service ko zabardasti girayen
docker compose stop flaky
sleep 5
docker compose logs --tail 5 client

# Wapas zinda karen
docker compose start flaky
sleep 12
docker compose logs --tail 8 client
```

> ✅ **Expected result:** Stop ke baad client `BLOCKED` (OPEN state) me fast-fail karta hai — resources zaya nahi hote. Start ke baad, recovery timeout guzarne pe `HALF-OPEN` probe jata hai, kamyab hota hai, aur breaker `CLOSED` ho jata hai. **Self-healing system!** 🎉

### Step 8 — Cleanup

```bash
docker compose down
cd ~ && rm -rf ~/cb-lab
```

## ✅ Checkpoint

**Q1: Circuit breaker ki teeno states kya hain aur har ek me kya hota hai?**
A: **CLOSED** — requests normal flow, failures gini jati hain. **OPEN** — calls foran reject (fail fast), downstream ko rest milta hai. **HALF-OPEN** — recovery timeout ke baad sirf ek probe request, kamyab to CLOSED, fail to wapas OPEN.

**Q2: Retry karte waqt backoff aur jitter kyun zaroori hain?**
A: Bina waqfe ke foran retry se struggling service pe load aur barhta hai (retry storm). Exponential backoff waqfa barhata hai, jitter randomness add karta hai taake saare clients ek saath retry na karen.

**Q3: Idempotent operation kya hai aur retry se iska kya taluq hai?**
A: Idempotent operation ko dobara chalane se nateeja nahi badalta (jaise `GET`). Retry sirf idempotent operations pe safe hai — `POST /payment` dobara bhejna double charge karwa sakta hai!

**Q4: Docker healthcheck aur circuit breaker me kya farq hai?**
A: Healthcheck infrastructure level pe batata hai ke container *zinda aur kaam ke qabil* hai (orchestrator usay restart/replace karta hai). Circuit breaker application level pe caller ko bachata hai — wo unhealthy downstream ko calls bhejna band kar deta hai. Dono ek dusre ke saathi hain.

## 🔜 Next Week

Next week: Week 13 ka teaser — ab tak hum ne traffic ko secure, observe aur resilient banana seekha; agle week dekhenge ke ye sab **production-grade Docker Compose stacks** me kaise jurta hai.
