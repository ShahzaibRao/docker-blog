---
author: Rao Shahzaib
pubDatetime: 2026-10-04T10:00:00Z
title: "Week 9: Service Mesh with Linkerd"
description: "What is a service mesh? Learn the sidecar pattern, mTLS and observability, then install Linkerd on a k3d (k3s-in-Docker) cluster with an emojivoto demo and a traffic-splitting lab."
tags: ["docker", "docker-360", "service-mesh", "linkerd"]
---

> 🐳 **Docker 360 — Week 9 of 16** | Service mesh with Linkerd — sidecars, mTLS & observability on k3d

## 🎯 Learning Objective

By the end of this week, you will understand what a service mesh actually is and why microservices need one. You will see how the **sidecar pattern** adds encryption, retries and metrics to your services **without changing a single line of application code** — and you will install **Linkerd** on a lightweight Kubernetes cluster running entirely inside Docker (k3d), then prove mTLS and traffic splitting work with your own hands.

## 🎨 Visual Diagrams

**Without a service mesh — every app fends for itself:**

```text
┌──────────┐    plain HTTP     ┌──────────┐    plain HTTP     ┌──────────┐
│ service A│ ────────────────▶ │ service B│ ────────────────▶ │ service C│
└──────────┘  no encryption   └──────────┘  no retries,      └──────────┘
              no metrics                    no timeouts,
                                            failures cascade
```

*Iska matlab ye hai ke* — har service ko khud encryption, retry logic aur monitoring likhni parti hai. Har language me dobara. Bohat toil.

**With a service mesh — a tiny proxy (sidecar) sits next to every service:**

```text
┌────────────────────────────────┐          ┌────────────────────────────────┐
│             Pod A              │          │             Pod B              │
│  ┌───────────┐   ┌──────────┐  │   mTLS   │  ┌──────────┐   ┌───────────┐  │
│  │ service A │──▶│  proxy   │──┼─────────▶┼─▶│  proxy   │──▶│ service B │  │
│  │  (app)    │   │ (sidecar)│  │ encrypted│  │ (sidecar)│   │  (app)    │  │
│  └───────────┘   └──────────┘  │          │  └──────────┘   └───────────┘  │
└────────────────────────────────┘          └────────────────────────────────┘
        ▲ app code unchanged — the proxy handles security & observability
```

**Linkerd architecture — control plane vs data plane:**

```text
                    ┌──────────────────────────────────┐
                    │          CONTROL PLANE           │
                    │   identity · destination · policy │
                    │   (hands out configs + mTLS certs)│
                    └────────────────┬─────────────────┘
                                     │ config + certificates
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
  ┌───────────┐               ┌───────────┐                ┌───────────┐
  │ proxy +   │◀─── mTLS ────▶│ proxy +   │◀──── mTLS ────▶│ proxy +   │
  │ app       │   DATA PLANE  │ app       │   DATA PLANE   │ app       │
  └───────────┘               └───────────┘                └───────────┘
```

## 🧠 Theory Deep Dive

### What is a service mesh, really?

Jab aap ke paas 3–4 services hain, to un ke darmiyan baat-cheet simple hai. Jab 30–40 services hain — kuch Python me, kuch Go me, kuch Node me — to sawal paida hote hain:

- Service A ko service B se **encrypted** baat karni hai — har language me TLS code kaun likhega?
- Service B slow hai — **timeout aur retry** ka logic har app me copy-paste karenge?
- Production me request fail hui — **kis service ne der lagayi**, ye kaise pata chalega?

*Simple lafzon me:* a **service mesh** is a dedicated infrastructure layer that handles service-to-service communication — security, reliability, observability — so your application code doesn't have to.

### The sidecar pattern

Sidecar ka concept bilkul motorcycle wali sidecar jaisa hai — chhoti si extra seat jo main sawari ke saath jurri hoti hai. Kubernetes me har Pod ke andar aap ke app container ke **saath** ek lightweight proxy container inject hota hai. App ko lagta hai wo seedha dusri service se baat kar raha hai; asal me uska saara traffic proxy se guzarta hai.

| Responsibility | App container | Sidecar proxy |
|---|---|---|
| Business logic | ✅ | ❌ |
| mTLS encryption | ❌ | ✅ |
| Retries & timeouts | ❌ | ✅ |
| Metrics & tracing headers | ❌ | ✅ |
| Traffic shifting (canary) | ❌ | ✅ |

*Yahi woh jagah hai jahan magic hota hai* — aap ne app ka ek line bhi nahi badla, phir bhi usko enterprise-grade networking mil gayi.

### mTLS — encryption without code changes

mTLS (mutual TLS) ka matlab hai ke **dono taraf** ek dusre ki identity verify karte hain — client server ko, server client ko. Service mesh ka control plane har proxy ko short-lived certificates deta hai aur unhe automatically rotate karta hai.

Iska faida? Aap ka `http://service-b/` wala plain request Pod se bahar nikalte hi encrypted ho jata hai, aur dusri taraf sirf verified services hi connect kar sakti hain. Zero-trust networking — *bina ek line TLS code likhe*.

### Observability for free — the golden signals

Jab saara traffic proxy se guzarta hai, to proxy har request ko measure kar sakta hai. Isi liye mesh lagate hi aap ko ye **golden signals** mil jate hain:

| Signal | Sawal jiska jawab milta hai |
|---|---|
| **Latency** | Request me kitna time laga? p50/p95/p99 kitna hai? |
| **Traffic** | Kitni requests per second aa rahi hain? |
| **Errors** | Kitni requests fail ho rahi hain? |
| **Saturation** | Service kitni busy hai? |

### Why Linkerd? Why k3d?

Service mesh ki duniya me Istio sab se mashhoor hai, lekin wo bhaari hai — seekhne ke liye ideal nahi. **Linkerd** isko "ultralight" rakhta hai: chhota, tez, aur samajhne me aasaan. Concepts wahi hain jo har mesh me kaam aate hain.

Aur **k3d** kya hai? Ye **k3s (lightweight Kubernetes) ko Docker containers ke andar chalata hai**. *Iska matlab ye hai ke* poora Kubernetes cluster aap ke Docker daemon ke andar sirf containers ki shakal me chal raha hai — Docker 360 ke theme ke saath perfect match. Kubernetes seekhne ka sab se halka tareeqa.

| Component | Role |
|---|---|
| **Control plane** | Config, mTLS certificates, policy — decisions leta hai |
| **Data plane** | Sidecar proxies — asal traffic handle karte hain |

## 💻 Hands-On Lab

> **Prerequisites:** Docker, `kubectl`, aur `k3d` installed. k3d install: `curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash`

### Step 1 — Create a k3d cluster (Kubernetes inside Docker!)

```bash
k3d cluster create docker360 --agents 1
```

> ✅ **Expected result:** `Cluster 'docker360' created successfully!` — aur `docker ps` me aap ko `k3d-docker360-server-0` jaise containers nazar aayenge. Poora cluster Docker ke andar!

### Step 2 — Install the Linkerd CLI

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://run.linkerd.io/install | sh
export PATH=$PATH:~/.linkerd2/bin
linkerd version
```

> ✅ **Expected result:** `Client version: stable-X.Y.Z` print hota hai.

### Step 3 — Pre-flight check

```bash
linkerd check --pre
```

> ✅ **Expected result:** Saari lines `√`. Ye confirm karta hai ke cluster Linkerd ke liye tayyar hai.

### Step 4 — Install Linkerd control plane

```bash
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -
```

Ye do commands CRDs (custom resource definitions) aur phir control plane install karti hain. Thora waqt lagega — certificates generate hote hain.

### Step 5 — Verify the installation

```bash
linkerd check
```

> ✅ **Expected result:** Har check `√` — `linkerd-identity`, `linkerd-destination` waghera sab `running` hain. Control plane tayyar!

### Step 6 — Install the viz extension (observability dashboard)

```bash
linkerd viz install | kubectl apply -f -
linkerd viz check
```

### Step 7 — Deploy the emojivoto demo app

```bash
kubectl apply -f https://run.linkerd.io/emojivoto.yml
kubectl -n emojivoto get pods
```

Emojivoto ek cute demo app hai — emoji voting wali microservices app.

### Step 8 — Inject the Linkerd sidecars ✨

```bash
kubectl -n emojivoto get deploy -o yaml \
  | linkerd inject - \
  | kubectl apply -f -
```

*Dekho kitna simple hai* — hum ne YAML nikala, `linkerd inject` se har Pod me proxy container add karwaya, aur wapas apply kar diya. App ka code zero change.

### Step 9 — Prove the mesh is working

```bash
linkerd viz stat -n emojivoto deploy
```

> ✅ **Expected result:** Har deployment ke saamne `MESHED 1/1` — matlab har Pod me proxy chal raha hai.

Ab mTLS verify karte hain:

```bash
linkerd viz edges deploy -n emojivoto
```

> ✅ **Expected result:** Edges ki list me connections `TLS` ke saath marked — *iska matlab ye hai ke* service-to-service traffic encrypted hai, bina app ne kuch kiye!

### Step 10 — Open the app and the dashboard

```bash
kubectl -n emojivoto port-forward svc/web-svc 8080:80 &
```

Browser me `http://localhost:8080` kholo — emoji vote karo, traffic generate karo. Phir dashboard dekho:

```bash
linkerd viz dashboard &
```

Golden signals live nazar aayenge — request rate, latency, success rate. 🎉

### Step 11 — Lab: traffic splitting (canary release)

Ab asli power dekhte hain. Hum do versions deploy karenge aur traffic 90/10 split karenge — **bina app restart kiye**.

Pehle ek namespace banao jahan auto-injection on ho:

```bash
kubectl create namespace split-demo
kubectl annotate namespace split-demo linkerd.io/inject=enabled
```

Do versions deploy karo (file: `whoami.yaml`):

```bash
cat > whoami.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whoami-v1
  namespace: split-demo
spec:
  replicas: 1
  selector:
    matchLabels: {app: whoami, version: v1}
  template:
    metadata:
      labels: {app: whoami, version: v1}
    spec:
      containers:
      - name: whoami
        image: hashicorp/http-echo:1.0
        args: ["-text=v1-response", "-listen=:5678"]
        ports: [{containerPort: 5678}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whoami-v2
  namespace: split-demo
spec:
  replicas: 1
  selector:
    matchLabels: {app: whoami, version: v2}
  template:
    metadata:
      labels: {app: whoami, version: v2}
    spec:
      containers:
      - name: whoami
        image: hashicorp/http-echo:1.0
        args: ["-text=v2-response", "-listen=:5678"]
        ports: [{containerPort: 5678}]
---
apiVersion: v1
kind: Service
metadata:
  name: whoami-v1
  namespace: split-demo
spec:
  selector: {app: whoami, version: v1}
  ports: [{port: 80, targetPort: 5678}]
---
apiVersion: v1
kind: Service
metadata:
  name: whoami-v2
  namespace: split-demo
spec:
  selector: {app: whoami, version: v2}
  ports: [{port: 80, targetPort: 5678}]
---
apiVersion: v1
kind: Service
metadata:
  name: whoami-svc
  namespace: split-demo
spec:
  selector: {app: whoami}
  ports: [{port: 80, targetPort: 5678}]
EOF
kubectl apply -f whoami.yaml
```

Ab TrafficSplit rule lagao:

```bash
cat > trafficsplit.yaml <<'EOF'
apiVersion: split.smi-spec.io/v1alpha2
kind: TrafficSplit
metadata:
  name: whoami-split
  namespace: split-demo
spec:
  service: whoami-svc
  backends:
  - service: whoami-v1
    weight: 900m
  - service: whoami-v2
    weight: 100m
EOF
kubectl apply -f trafficsplit.yaml
```

*Yahan trick ye hai:* TrafficSplit mesh ke **andar** kaam karta hai — is liye hum cluster ke andar se hi ek meshed client chalayenge:

```bash
kubectl -n split-demo run curl-client --image=curlimages/curl \
  --restart=Never -it --rm -- sh -c \
  'for i in $(seq 1 20); do curl -s http://whoami-svc/; echo; done | sort | uniq -c'
```

> ✅ **Expected result:** taqreeban `18 v1-response` aur `2 v2-response` — 90/10 split kaam kar raha hai! Yehi canary releases ka foundation hai.

### Step 12 — Cleanup

```bash
k3d cluster delete docker360
```

## ✅ Checkpoint

**Q1: Sidecar pattern me proxy kahan chalta hai?**
A: Har Pod ke andar, app container ke saath ek alag container ki shakal me. App ka traffic transparently us se guzarta hai.

**Q2: mTLS normal TLS se kaise mukhtalif hai?**
A: Normal TLS me sirf client server ko verify karta hai; mTLS me **dono taraf** ek dusre ko certificates se verify karte hain — is liye sirf trusted services hi aapas me baat kar sakti hain.

**Q3: Linkerd ka control plane aur data plane me kya farq hai?**
A: Control plane (identity, destination) config aur certificates deta hai — decisions leta hai. Data plane (sidecar proxies) asal request traffic handle karta hai.

**Q4: TrafficSplit rule apply karne ke liye client ka meshed hona kyun zaroori hai?**
A: Kyun ke split ko enforce karne wala client-side ka Linkerd proxy hai. Agar caller ke paas proxy nahi, to rule parhne wala koi nahi — is liye hum ne cluster ke andar meshed curl pod use kiya.

## 🔜 Next Week

Next week: API Gateway with Kong — edge pe routing, authentication aur rate limiting, sab Docker me.
