---
author: Rao Shahzaib
pubDatetime: 2026-09-20T00:00:00Z
title: "Week 10: API Gateway with Kong"
description: "Learn API gateway concepts — routing, authentication and rate limiting at the edge — then run Kong in Docker with declarative DB-less config and test a rate-limiting lab with curl."
tags: ["docker", "docker-360", "kong", "api-gateway"]
---

> 🐳 **Docker 360 — Week 10 of 16** | API gateway with Kong — routing, auth & rate limiting at the edge

## 🎯 Learning Objective

By the end of this week, you will understand why microservices need an **API gateway** sitting at the edge of your system. You will run **Kong in Docker in DB-less (declarative) mode**, define services and routes in a single YAML file, and prove **rate limiting** works by hammering the gateway with curl and watching it return `429 Too Many Requests` exactly when it should.

## 🎨 Visual Diagrams

**Without a gateway — clients talk to every service directly:**

```text
            ┌─────────────┐
            │  web client │
            └──────┬──────┘
                   │  each client must know every
        ┌──────────┼──────────┐  service address, handle
        ▼          ▼          ▼  auth, retries, rate limits
  ┌──────────┐ ┌────────┐ ┌─────────┐
  │ users    │ │ orders │ │ payments│
  │ service  │ │ service│ │ service │
  └──────────┘ └────────┘ └─────────┘
```

**With a gateway — one door, all the rules in one place:**

```text
  clients ──▶ ┌───────────────────────────────────┐ ──▶ ┌──────────┐
              │           KONG GATEWAY            │     │ users    │
              │  ┌────────┐  ┌────────┐  ┌──────┐ │ ──▶ │ orders   │
              │  │ routing│  │  auth  │  │ rate │ │ ──▶ │ payments │
              │  └────────┘  └────────┘  │limit │ │     └──────────┘
              │        ▲ plugins (add/remove without code change) │
              └───────────────────────────────────┘
```

**Request flow through Kong:**

```text
curl /echo/get
      │
      ▼
┌─────────────┐   route match?    ┌──────────┐   plugins run   ┌───────────┐
│ Kong :8000  │ ───────────────▶ │  route   │ ──────────────▶ │ upstream  │
│ (proxy)     │   /echo/* ──▶    │ echo-    │   rate-limit,   │ httpbin   │
└─────────────┘   echo-service   │ route    │   key-auth...   │ :80       │
                                 └──────────┘                 └───────────┘
```

## 🧠 Theory Deep Dive

### What is an API gateway, really?

Jab aap ke paas ek monolith hota hai, clients ko ek hi address pata hota hai. Microservices me 10 services = 10 addresses, 10 auth implementations, 10 rate-limit logics. *Iska matlab ye hai ke* har client (web, mobile, partner API) ko har service ka pata hona chahiye — aur security har jagah dobara likhni parti hai.

*Simple lafzon me:* an **API gateway** is a single entry point for all clients. Wo request leta hai, decide karta hai ke ye kis service ke liye hai (routing), checks lagata hai (authentication, rate limiting, logging), aur phir request ko sahi upstream service tak pohnchata hai.

### Reverse proxy vs API gateway

| | Reverse proxy (e.g. plain Nginx) | API gateway (e.g. Kong) |
|---|---|---|
| **Main job** | Forward requests | Forward + API management |
| **Routing** | Basic path/host | Rich routing, versioning |
| **Auth** | Manual config | Built-in plugins (key-auth, JWT, OAuth2) |
| **Rate limiting** | Possible, clunky | First-class plugin |
| **Extensibility** | Config files | Plugin ecosystem (40+ official) |

Har API gateway ek reverse proxy hai, lekin har reverse proxy API gateway nahi. Gateway = proxy + API-specific intelligence.

### Kong's building blocks

Kong ko samajhne ke liye sirf 4 lafz yaad rakho:

| Object | Matlab |
|---|---|
| **Service** | Aap ki asal backend — naam + upstream URL (e.g. `http://httpbin:80`) |
| **Route** | Rule jo batata hai ke kaunsi request kis service ko jayegi (e.g. path `/echo/*`) |
| **Plugin** | Extra functionality — rate limiting, auth, transformations, logging |
| **Consumer** | API ko use karne wala client/app (auth ke liye identity) |

Flow hamesha yehi hai: **request → Route match → Service select → Plugins run → upstream**.

### DB-less (declarative) mode

Kong do tareeqon se chal sakta hai: database (Postgres) ke saath, ya **DB-less** jahan poori config ek YAML file me hoti hai. Seekhne, GitOps aur Docker Compose setups ke liye DB-less perfect hai — *config file hi source of truth hai*, version control me rakho, container restart karo, config apply.

## 💻 Hands-On Lab

### Step 1 — Create a network and a backend service

```bash
docker network create kong-net

docker run -d --name httpbin --network kong-net kennethreitz/httpbin
```

httpbin humara dummy upstream hai — wo `/get`, `/post` jaise endpoints deta hai taake hum gateway test kar saken.

> ✅ **Expected result:** `docker ps` me `httpbin` running nazar aaye.

### Step 2 — Write the declarative config

```bash
mkdir -p ~/kong-lab && cd ~/kong-lab

cat > kong.yml <<'EOF'
_format_version: "3.0"

services:
  - name: echo-service
    url: http://httpbin:80
    routes:
      - name: echo-route
        paths:
          - /echo
        strip_path: true
    plugins:
      - name: rate-limiting
        config:
          minute: 5
          policy: local
          limit_by: ip
EOF
```

*Dekho kitna readable hai:* ek service (`echo-service` → `http://httpbin:80`), ek route (`/echo/*`), aur ek plugin (har IP ko **5 requests per minute**). `strip_path: true` ka matlab — `/echo/get` upstream ko `/get` ban ke jayega.

### Step 3 — Run Kong in DB-less mode

```bash
docker run -d --name kong-gateway --network kong-net \
  -v "$PWD/kong.yml:/kong/declarative/kong.yml:ro" \
  -e KONG_DATABASE=off \
  -e KONG_DECLARATIVE_CONFIG=/kong/declarative/kong.yml \
  -e KONG_PROXY_LISTEN=0.0.0.0:8000 \
  -e KONG_ADMIN_LISTEN=0.0.0.0:8001 \
  -p 8000:8000 -p 8001:8001 \
  kong:latest

sleep 8 && docker ps --filter name=kong-gateway --format '{{.Names}}: {{.Status}}'
```

> ✅ **Expected result:** `kong-gateway: Up ...` — agar container foran exit ho jaye to `docker logs kong-gateway` dekho; aksar YAML me indentation ka masla hota hai. Kong start pe config validate karta hai, ghalat config pe wo start hi nahi hota (fail-fast — achi baat!).

### Step 4 — Test routing through the gateway

```bash
curl -s http://localhost:8000/echo/get | head -c 200; echo
```

> ✅ **Expected result:** httpbin ka JSON response — matlab request Kong se guzar ke upstream tak pohnchi aur wapas aayi. Direct `httpbin:80` client ko pata bhi nahi!

Admin API se config verify karo:

```bash
curl -s http://localhost:8001/services/echo-service | grep -o '"name":"[^"]*"'
```

### Step 5 — Lab: rate limiting in action 🧪

Ab maza aayega. 8 requests bhejo, ek second se bhi kam waqfe me:

```bash
for i in $(seq 1 8); do
  printf "req %s -> " "$i"
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/echo/get
done
```

> ✅ **Expected result:**
> ```
> req 1 -> 200
> req 2 -> 200
> req 3 -> 200
> req 4 -> 200
> req 5 -> 200
> req 6 -> 429
> req 7 -> 429
> req 8 -> 429
> ```
> Pehli 5 requests `200`, us ke baad `429 Too Many Requests`. *Yahi rate limiting hai* — gateway ne upstream ko flood hone se bacha liya, aur app code me ek line nahi likhni pari!

Rate limit headers bhi dekho:

```bash
curl -sI http://localhost:8000/echo/get | grep -i ratelimit
```

> ✅ **Expected result:** `RateLimit-Limit: 5`, `RateLimit-Remaining: ...` jaise headers — client ko pata chalta hai ke uska quota kitna bacha hai.

Ek minute ruko, phir dobara try karo — quota reset ho jayega.

### Step 6 — Bonus: add API key authentication 🔑

Gateway ki asal taqat plugins ka combination hai. `kong.yml` me key-auth add karo:

```bash
cat > kong.yml <<'EOF'
_format_version: "3.0"

services:
  - name: echo-service
    url: http://httpbin:80
    routes:
      - name: echo-route
        paths:
          - /echo
        strip_path: true
    plugins:
      - name: rate-limiting
        config:
          minute: 5
          policy: local
          limit_by: ip
      - name: key-auth

consumers:
  - username: demo-app
    keyauth_credentials:
      - key: demo-key-abc123
EOF

docker rm -f kong-gateway
docker run -d --name kong-gateway --network kong-net \
  -v "$PWD/kong.yml:/kong/declarative/kong.yml:ro" \
  -e KONG_DATABASE=off \
  -e KONG_DECLARATIVE_CONFIG=/kong/declarative/kong.yml \
  -e KONG_PROXY_LISTEN=0.0.0.0:8000 \
  -e KONG_ADMIN_LISTEN=0.0.0.0:8001 \
  -p 8000:8000 -p 8001:8001 \
  kong:latest
sleep 8
```

Ab test karo — pehle bina key:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/echo/get
```

> ✅ **Expected result:** `401 Unauthorized` — darwaza band!

Ab key ke saath:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: demo-key-abc123" http://localhost:8000/echo/get
```

> ✅ **Expected result:** `200` — key sahi, darwaza khul gaya. Aur ye auth bhi gateway pe hua, upstream app ko iski khabar tak nahi.

### Step 7 — Cleanup

```bash
docker rm -f kong-gateway httpbin
docker network rm kong-net
```

## ✅ Checkpoint

**Q1: API gateway ka sab se bunyadi kaam kya hai?**
A: Saare clients ke liye **single entry point** banna — request lo, route match karo, checks (auth, rate limit) lagao, sahi upstream service ko forward karo.

**Q2: Kong me Service aur Route me kya farq hai?**
A: Service asal backend ko represent karta hai (upstream URL), Route wo rule hai jo batata hai ke kaunsi incoming request kis Service ko jayegi (jaise path `/echo/*`).

**Q3: DB-less mode ka faida kya hai?**
A: Poori gateway config ek YAML file me hoti hai — koi database nahi. Config version control me rakho, container ke saath mount karo, aur GitOps-style deploy karo.

**Q4: Lab me 6th request pe 429 kyun aaya?**
A: Kyun ke `rate-limiting` plugin `minute: 5` pe set tha — ek IP se ek minute me sirf 5 requests allowed thin. 6th request quota se bahar thi, is liye gateway ne usay upstream tak jaane hi nahi diya.

## 🔜 Next Week

Next week: Distributed Tracing with Jaeger — ek request ka peecha karo jab wo kayi services se guzarti hai, aur waterfall me dekho ke time kahan laga.
