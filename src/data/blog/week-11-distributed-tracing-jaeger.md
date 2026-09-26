---
author: Rao Shahzaib
pubDatetime: 2026-09-21T00:00:00Z
title: "Week 11: Distributed Tracing with Jaeger"
description: "Learn distributed tracing concepts — traces, spans and context propagation — then run Jaeger all-in-one in Docker, trace the HotROD demo app end-to-end and read a trace waterfall."
tags: ["docker", "docker-360", "observability", "jaeger"]
---

> 🐳 **Docker 360 — Week 11 of 16** | Distributed tracing with Jaeger — follow one request across services

## 🎯 Learning Objective

By the end of this week, you will understand how **distributed tracing** answers the hardest microservices question: *"request slow kyun hui — time kahan laga?"* You will run **Jaeger all-in-one in Docker**, fire up the **HotROD demo app**, trace a real request end-to-end, and learn to read a **trace waterfall** like a pro.

## 🎨 Visual Diagrams

**The problem — a slow request, but who is guilty?**

```text
user ──▶ frontend ──▶ customer-svc ──▶ driver-svc ──▶ route-svc
  "page took 3 seconds!"
              ▲           ▲              ▲              ▲
              │           │              │              │
           logs say    logs say       logs say       logs say
           "I was      "I was         "I was         "I was
            fast!"      fast!"         fast!"         fast!"
```

*Har service ke logs alag, time alag — ek request ki kahani jurna namumkin.*

**The answer — one trace, many spans:**

```text
trace id: 7f3a9c...  (total: 850ms)          ◀── one user request
│
└── span: frontend  GET /dispatch        850ms
    ├── span: customer  getCustomer      120ms
    ├── span: driver    findDriver       300ms
    │   └── span: redis  GET driver:42    45ms
    └── span: route     calcRoute         410ms  ◀── culprit found!
```

**Context propagation — the trace ID travels with the request:**

```text
┌──────────┐   traceparent: 00-7f3a9c-abc123-01   ┌──────────┐
│service A │ ──────────────────────────────────▶ │service B │
└──────────┘   (trace ID passed in HTTP header)   └──────────┘
                                                          │
                                          traceparent: 00-7f3a9c-def456-01
                                                          ▼
                                                    ┌──────────┐
                                                    │service C │
                                                    └──────────┘
   same trace ID (7f3a9c) everywhere → Jaeger joins the spans
```

**Jaeger all-in-one — everything in a single container:**

```text
                    ┌────────────────────────────────────┐
  your services     │        JAEGER ALL-IN-ONE           │
  ──spans────────▶  │  agent → collector → storage(query)│
  (UDP 6831 /       │                                    │
   HTTP 14268)      │   UI :16686  ←── you look here 👀   │
                    └────────────────────────────────────┘
```

## 🧠 Theory Deep Dive

### Trace, span, log — teeno me farq

| Concept | Matlab | Example |
|---|---|---|
| **Log** | Ek service ka ek waqiya, isolated | `"order created"` in orders-svc |
| **Span** | Ek **operation** ka timed record — naam, start/end time, parent | `GET /dispatch` took 850ms |
| **Trace** | Ek user request ke **saare spans** ka tree, ek trace ID se jura hua | Poori kahani: frontend → customer → driver → route |

*Simple lafzon me:* logs batate hain **kya** hua, traces batate hain **kahan aur kitna time laga**. Dono mil ke debugging poori hoti hai.

### Context propagation — trace ID safar kaise karta hai?

Ye tracing ka sab se clever hissa hai. Jab request service A se service B ko jati hai, to tracing library (OpenTelemetry SDK) HTTP headers me do cheezen inject karti hai — W3C standard ke mutabiq `traceparent` header:

```
traceparent: 00-7f3a9c21e8b44d6a-abc123def456-01
             │  │                │              └ sampled? (01 = yes)
             │  │                └ span ID (is hop ka)
             │  └ trace ID (poori request ka — har hop me SAME)
             └ version
```

*Iska matlab ye hai ke* har service ko pata hai ke wo kis bari kahani (trace) ka hissa hai — aur Jaeger in sab spans ko ek trace ID se jor ke waterfall bana deta hai. Aap ke app code me aap ne sirf SDK lagaya; headers ka kaam library karti hai.

### Sampling — har request trace nahi hoti

Production me lakhon requests hoti hain — sab ko store karna mehnga hai. Is liye **sampling**: har N me se ek trace save hoti hai (e.g. 1%). Errors wali traces aksar hamesha save hoti hain (tail-based sampling). Development me hum 100% rakhte hain taake har click nazar aaye.

### OpenTelemetry — the modern instrumentation standard

Aaj kal tracing ke liye **OpenTelemetry (OTel)** standard hai — ye vendor-neutral SDKs deta hai (Python, Go, Node, Java...) jo spans banate hain aur unhe kisi bhi backend (Jaeger, Tempo, Zipkin) ko bhejte hain. Jaeger natively OTLP protocol support karta hai.

*Iska matlab ye hai ke* aap apni app me **ek baar** OTel SDK lagate ho, aur backend badalna ho to sirf exporter ka endpoint badlo — code dobara instrument nahi karna parta. HotROD demo bhi OpenTelemetry se instrumented hai, isi liye wo seedha Jaeger ko spans bhejta hai.

| Layer | Example |
|---|---|
| **Instrumentation** (spans banata hai) | OpenTelemetry SDK in your app |
| **Transport** (spans bhejta hai) | OTLP / Jaeger agent protocol |
| **Backend** (store + visualize) | Jaeger all-in-one |

### Jaeger components

| Component | Kaam |
|---|---|
| **Agent** | Har host/service ke paas, spans receive karta hai (UDP) |
| **Collector** | Spans validate + process karke storage me dalta hai |
| **Query** | UI/API ko stored traces deta hai |
| **UI** | Waterfall visualization — `:16686` |
| **All-in-one** | Ye chaaro ek container me — learning ke liye perfect |

### The observability triad — logs, metrics, traces ek saath

Ek baat zehen me rakho: tracing **logs aur metrics ko replace nahi karta** — teeno mil ke poori picture banate hain:

- **Metrics** batate hain *kuch ghalat hai* — "error rate 5% se barh gaya!" (alert yahin se aata hai)
- **Traces** batate hain *kahan ghalat hai* — "route service 410ms le rahi hai" (waterfall yahin dikhta hai)
- **Logs** batate hain *kyun ghalat hai* — "route service me NullPointerException" (root cause yahin milta hai)

*Iska matlab ye hai ke* debugging ka flow hamesha yehi hai: **metric → trace → log**. Alert baje → trace kholo → culprit span dhoondo → us service ke logs parho. Is week me hum ne beech wali karri seekh li. 💪

## 💻 Hands-On Lab

### Step 1 — Create a network

```bash
docker network create tracing-net
```

### Step 2 — Run Jaeger all-in-one

```bash
docker run -d --name jaeger --network tracing-net \
  -e COLLECTOR_ZIPKIN_HOST_PORT=:9411 \
  -p 16686:16686 \
  -p 14268:14268 \
  -p 6831:6831/udp \
  jaegertracing/all-in-one:latest

sleep 10 && curl -s -o /dev/null -w "Jaeger UI: %{http_code}\n" http://localhost:16686/
```

> ✅ **Expected result:** `Jaeger UI: 200` — browser me `http://localhost:16686` kholo, Jaeger ka UI nazar aayega (abhi traces khaali hongi — koi app connect nahi hui).

### Step 3 — Run the HotROD demo app

HotROD ek car-dispatch demo hai — 4 microservices: `frontend`, `customer`, `driver`, `route`. Isko Jaeger agent ki taraf point karte hain:

```bash
docker run -d --name hotrod --network tracing-net \
  -p 8080:8080 \
  -e JAEGER_AGENT_HOST=jaeger \
  -e JAEGER_AGENT_PORT=6831 \
  jaegertracing/example-hotrod:latest

sleep 8 && curl -s -o /dev/null -w "HotROD: %{http_code}\n" http://localhost:8080/
```

> ✅ **Expected result:** `HotROD: 200`. `JAEGER_AGENT_HOST=jaeger` ka matlab — container `jaeger` naam se agent ko dhoond lega (same Docker network ka DNS magic).

### Step 4 — Generate a trace 🖱️

1. Browser me `http://localhost:8080` kholo — HotROD ka dispatch UI.
2. Kisi customer button pe click karo (e.g. **"Dispatch order"** / customer name).
3. Page reload hogi aur ek ride dispatch hogi — *is click ne darjanon spans generate kiye!*

### Step 5 — Find your trace in Jaeger

1. `http://localhost:16686` kholo.
2. Left sidebar me **Service** dropdown se `frontend` select karo.
3. **Find Traces** dabao — traces ki list aayegi.
4. Sab se upar wali trace pe click karo.

> ✅ **Expected result:** Ek **waterfall** khulta hai — root span `frontend: HTTP GET /dispatch`, us ke neeche `customer`, `driver`, `route` jaise child spans, har ek apni duration bar ke saath. *Yehi distributed tracing hai!*

### Step 6 — Read the waterfall like a detective 🕵️

Ab waterfall ko parho:

- **Sab se lambi bar** dhoondo — wahi culprit hai. Aksar `route` service sab se zyada time leti hai (wo route calculate karti hai).
- Kisi span pe click karo — **Tags** me `http.status_code`, `peer.service` jaisi details, aur **Process** me kaunsi service ne bheja.
- Dekho ke spans **parallel** chale ya **sequential** — waterfall ki shape se pata chalta hai ke `customer` aur `driver` calls ek ke baad ek hui ya saath.

> ✅ **Expected result:** Tum bata sako ke "850ms ki request me se 410ms `route` service ne liye" — *bina ek bhi log file khole*. Yahi tracing ki power hai.

Ek typical HotROD trace kuch aisi lagti hai:

| Span | Service | Duration | Note |
|---|---|---|---|
| `frontend: HTTP GET /dispatch` | frontend | 850ms | Root span — poori request |
| `customer: GetCustomer` | customer | 120ms | DB lookup jaisa kaam |
| `driver: FindNearest` | driver | 300ms | Redis call bhi iske andar |
| `route: CalcRoute` | route | 410ms | 🏆 Sab se lambi — culprit! |

### Step 6b — Troubleshooting: traces nazar na aayen to?

Agar Jaeger UI khaali hai to ye checklist chalao:

```bash
# 1. Kya HotROD Jaeger agent tak pohnch sakta hai?
docker exec hotrod env | grep JAEGER
# JAEGER_AGENT_HOST=jaeger hona chahiye

# 2. Kya dono containers ek hi network pe hain?
docker network inspect tracing-net --format '{{range .Containers}}{{.Name}} {{end}}'
# jaeger aur hotrod dono nazar aane chahiye

# 3. Kya agent UDP port sun raha hai?
docker exec jaeger netstat -ulnp 2>/dev/null | grep 6831 || echo "check via logs:"
docker logs jaeger --tail 5
```

> ✅ **Expected result:** Dono containers `tracing-net` pe, `JAEGER_AGENT_HOST=jaeger` set — 90% tracing problems network ya env var ki hoti hain!

### Step 7 — Bonus: query traces from the terminal

```bash
curl -s "http://localhost:16686/api/traces?service=frontend" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('traces found:', len(d['data']))"
```

> ✅ **Expected result:** `traces found: N` (N > 0) — UI ke peeche ek proper HTTP API hai.

### Step 8 — Cleanup

```bash
docker rm -f hotrod jaeger
docker network rm tracing-net
```

## ✅ Checkpoint

**Q1: Trace aur span me kya farq hai?**
A: Trace ek poori user request ki kahani hai (ek trace ID); span us kahani ka ek operation/bab hai (naam + duration + parent). Ek trace me darjanon spans hote hain.

**Q2: Context propagation kyun zaroori hai?**
A: Kyun ke trace ID ko HTTP headers (`traceparent`) me har service tak pohnchana parta hai — warna Jaeger alag-alag services ke spans ko ek trace me jor hi nahi sakta.

**Q3: Jaeger all-in-one me kaunse components ek saath chalte hain?**
A: Agent, collector, query service aur UI — chaaro ek container me. Production me ye alag-alag scale hote hain.

**Q4: Waterfall me sab se lambi bar ka kya matlab hai?**
A: Wo span sab se zyada time lene wala operation hai — aksar performance problem ki jar wahi hoti hai. Isi ko "culprit span" kehte hain.

## 🔜 Next Week

Next week: Resilience Patterns — Circuit Breakers. Jab downstream service mar jaye to aap ki app gracefully kaise survive kare — do containers ke saath live demo.
