---
author: Rao Shahzaib
pubDatetime: 2026-09-29T10:00:00Z
title: "Week 4: Orchestration Fundamentals"
description: "Step into orchestration — Docker Swarm vs Kubernetes compared, swarm cluster lab, replicated services, rolling updates, and self-healing."
tags: ["docker", "docker-360", "swarm", "orchestration"]
---

> 🐳 **Docker 360 — Week 4 of 16** | Orchestration: Swarm cluster, replicas, rolling updates aur self-healing

## 🎯 Learning Objective

Ab tak hum ne single machine par Docker chalaya. Lekin production me sawal hota hai: **agar machine hi down ho jaye to? Traffic barh jaye to?** Iska jawab hai **orchestration** — containers ko cluster me chalana, scale karna aur khud heal karna. Is week me tum Docker Swarm ka cluster banao ge, services ko replicate karo ge, zero-downtime rolling updates karo ge, aur dekho ge ke Swarm failed containers ko khud kaise wapas lata hai.

## 🎨 Visual Diagrams

### Swarm cluster architecture

```text
  ┌─────────────────────────────────────────────────────────┐
  │                    SWARM CLUSTER                        │
  │                                                         │
  │  ┌──────────────┐      ┌──────────────┐                   │
  │  │ MANAGER NODE │      │ WORKER NODE  │                   │
  │  │              │      │              │                   │
  │  │ ┌────────┐   │      │ ┌────────┐   │                   │
  │  │ │ task 1 │   │      │ │ task 3 │   │                   │
  │  │ │ (web)  │   │      │ │ (web)  │   │                   │
  │  │ └────────┘   │      │ └────────┘   │                   │
  │  │ ┌────────┐   │      │ ┌────────┐   │                   │
  │  │ │ task 2 │   │      │ │ task 4 │   │                   │
  │  │ │ (web)  │   │      │ │ (web)  │   │                   │
  │  │ └────────┘   │      │ └────────┘   │                   │
  │  └──────────────┘      └──────────────┘                   │
  │         │                      │                          │
  │         └────── Raft consensus ─┘                          │
  │         (managers cluster state agree karte hain)         │
  │                                                         │
  │  SERVICE "web" (replicas: 4)                             │
  │   = desired state. Swarm isko har haal me                 │
  │     maintain karta hai — node down ho ya                  │
  │     container crash, naye tasks schedule                  │
  │     ho jate hain.                                         │
  └─────────────────────────────────────────────────────────┘

  Tum SERVICE (kya chahiye) declare karte ho,
  Swarm TASKS (asal containers) khud manage karta hai.
```

### Rolling update — zero downtime kaise?

```text
  Time ──────────────────────────────────────────────►

  Start:   [v1] [v1] [v1] [v1] [v1] [v1]   (6 replicas)

  Step 1:  [v1] [v1] [v1] [v1] [v1] [v2]   (1 update ho raha)
           update_config: parallelism 1

  Step 2:  [v1] [v1] [v1] [v1] [v2] [v2]   (purana stop, naya
                                            healthy hone par aage)

  Step 3:  [v1] [v1] [v1] [v2] [v2] [v2]

  ...
  Done:    [v2] [v2] [v2] [v2] [v2] [v2]   (koi downtime nahi!)

  Agar naya version healthcheck fail kare to update RUK jata hai —
  aur `service update --rollback` se purana version wapas.
```

### Restart policy — self-healing flow

```text
  Container crash ho gaya (exit code != 0)
              │
              ▼
  ┌───────────────────────┐
  │ Swarm task state:     │
  │  SHUTDOWN (failed)    │
  └───────────┬───────────┘
              │  restart policy check:
              │  condition: on-failure
              ▼
  ┌───────────────────────┐
  │ delay 5s, phir naya   │──► max-attempts cross?
  │ task schedule karo    │         │ yes
              │           │         ▼
              ▼           │   task: REJECTED
  ┌───────────────────────┐    (manual fix chahiye)
  │ naya container UP,    │
  │ desired replicas      │
  │ wapas poore!          │
  └───────────────────────┘
```

## 🧠 Theory Deep Dive

### Orchestration kyun zaroori hai?

Single `docker run` me ye problems hain:

- Machine down → app down (koi failover nahi)
- Traffic spike → manual scale karna parta hai
- Update ke liye container stop → downtime
- Container crash → koi khud restart karne wala nahi (restart policy ke baghair)

**Orchestrator** desired state leta hai ("mujhe web ke 6 replicas chahiye, image v2 par") aur cluster ko us state par **rakhta** hai — yehi "reconciliation loop" hai.

### Docker Swarm vs Kubernetes — imandari se comparison

|  | Docker Swarm | Kubernetes |
|---|---|---|
| **Seekhne me** | Bohat easy — Docker CLI hi kaafi | Learning curve tez hai |
| **Setup** | `docker swarm init` — 1 command | kubeadm/k3s/managed service chahiye |
| **Concepts** | Service, task, stack | Pod, Deployment, Service, Ingress... |
| **Scaling** | `--replicas N` | HPA, VPA, cluster autoscaler |
| **Ecosystem** | Chhota | Bohat bara (Helm, operators, GitOps) |
| **Industry use** | Chhote/medium setups, edge | Large-scale production standard |
| **Status** | Docker me built-in, maintained | CNCF flagship project |

Imandari wali baat: **Swarm seekhna orchestration ke concepts (desired state, scheduling, rolling updates, service discovery) samajhne ka sab se tez tareeqa hai** — aur ye concepts Kubernetes me bhi wahi hain, sirf naam aur tooling alag. Swarm production me bhi chalta hai jahan simplicity chahiye, lekin bari industry Kubernetes par hai. Dono seekhna faida deta hai.

### Swarm ke core concepts

- **Node:** Cluster ka ek Docker host — `manager` (decisions leta hai) ya `worker` (tasks chalata hai).
- **Service:** Desired state ka elaan — "nginx ki image, 3 replicas, port 8080".
- **Task:** Service ka ek instance — asal me ek container. Ek task = ek container.
- **Stack:** Compose file se deploy hui services ka group (`docker stack deploy`).
- **Raft consensus:** Managers cluster state par agree karte hain — isi liye production me **odd number of managers (3 ya 5)** recommended hai (quorum ke liye).
- **Routing mesh:** Service ka published port **har node** par sunta hai — request jis node par aaye, Swarm usko sahi task tak pahuncha deta hai (internal load balancing ke sath).

### Rolling updates aur rollback

```bash
docker service update \
  --image nginx:1.27-alpine \
  --update-parallelism 2 \
  --update-delay 10s \
  --update-failure-action rollback \
  web
```

- `--update-parallelism`: ek waqt me kitne tasks update hon
- `--update-delay`: tasks ke darmiyan waqfa (naye ko healthy hone ka time)
- `--update-failure-action rollback`: agar healthcheck fail ho to khud purana version wapas

Iska matlab ye hai ke deployments me **downtime ka dar khatam** — aur agar kuch garbar ho to rollback ek command par.

## 💻 Hands-On Lab

> Lab: single machine kaafi hai — `swarm init` se ye khud manager + worker ban jata hai.

### Lab A — Swarm cluster init

**Step 1: Swarm initialize karo.**

```bash
# Apni machine ka LAN IP nikalo
MYIP=$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
echo "Using IP: $MYIP"
docker swarm init --advertise-addr "$MYIP"
```

✅ **Expected result:** `Swarm initialized: current node ... is now a manager.` Sath me worker join karne ka token bhi milta hai.

**Step 2: Cluster info dekho.**

```bash
docker node ls
docker swarm join-token worker   # doosri machine hoti to ye command wahan chalti
```

✅ **Expected result:** `node ls` me ek node `Leader` status ke sath. (Multi-node lab me token wali command worker machines par chalate.)

### Lab B — Replicated service

**Step 3: 3 replicas wali web service banao.**

```bash
docker service create --name web --replicas 3 -p 8080:80 nginx:alpine
sleep 5
docker service ls
docker service ps web
```

✅ **Expected result:** `service ls` me `3/3` replicas, `service ps` me 3 tasks `Running` state me. Teen containers — tum ne ek command chalayi, Swarm ne placement khud ki.

**Step 4: Scale up/down karo.**

```bash
docker service scale web=5
sleep 5
docker service ps web --format '{{.Name}} {{.CurrentState}}' | sort | uniq -c
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080
```

✅ **Expected result:** 5 tasks running, aur `curl` par `200`. Routing mesh ki wajah se port 8080 har node par kaam karta hai.

### Lab C — Rolling update aur rollback

**Step 5: Rolling update chalao.**

```bash
docker service update \
  --image nginx:1.27-alpine \
  --update-parallelism 1 \
  --update-delay 5s \
  web
docker service ps web
```

✅ **Expected result:** Tasks ek ek karke `Shutdown` → naya task `Running` hota hai. Beech me `curl` chalate raho:

```bash
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " http://localhost:8080; sleep 3; done; echo
```

✅ **Expected result:** Sab `200` — update ke doran **koi failed request nahi**. Yehi zero-downtime deployment hai.

**Step 6: Rollback karo.**

```bash
docker service update --rollback web
sleep 8
docker service ps web --format '{{.Image}}' | sort | uniq -c
```

✅ **Expected result:** Images wapas purani (`nginx:alpine`) par — rollback ek command me.

### Lab D — Healthcheck + restart policy = self-healing

**Step 7: Healthcheck wali service banao.**

```bash
docker service create --name api \
  --replicas 2 \
  --health-cmd "wget --no-verbose --tries=1 --spider http://localhost/ || exit 1" \
  --health-interval 10s \
  --health-timeout 3s \
  --health-retries 2 \
  --restart-condition on-failure \
  --restart-delay 5s \
  --restart-max-attempts 3 \
  nginx:alpine
sleep 12
docker service ps api
```

✅ **Expected result:** Dono tasks `Running`, aur inspect me health status `healthy`.

**Step 8: Ek container ko zabardasti maar do — Swarm kya karta hai?**

```bash
TASK_CONTAINER=$(docker ps --filter "name=api" --format '{{.ID}}' | head -1)
echo "Killing: $TASK_CONTAINER"
docker kill "$TASK_CONTAINER"
sleep 10
docker service ps api
```

✅ **Expected result:** Mari hui task `Failed`/`Shutdown` me, aur uski jagah ek **nayi task `Running`** — Swarm ne desired state (2 replicas) khud restore kar di. Tumhe kuch nahi karna para. **Yehi self-healing hai.**

**Step 9: Poori service ka health dekho.**

```bash
docker service inspect api --format='{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}}' | head -c 200; echo
docker service ls
```

✅ **Expected result:** Healthcheck config aur `2/2` replicas — cluster apni desired state par wapas.

**Cleanup:**

```bash
docker service rm web api
docker swarm leave --force
docker network prune -f
```

✅ **Expected result:** Services removed, node swarm se nikal gaya. Machine wapas normal Docker mode me.

## ✅ Checkpoint

**Q1: Swarm me service aur task me kya farq hai?**
A: **Service** desired state ka elaan hai ("nginx ke 3 replicas chahiye"). **Task** us service ka ek chalta hua instance hai — asal me ek container. Ek service ke multiple tasks hote hain.

**Q2: Rolling update me `--update-parallelism 1` aur `--update-delay` ka kya role hai?**
A: Parallelism control karta hai ke ek waqt me kitne tasks update hon, delay har batch ke darmiyan waqfa deta hai taake naya task healthy ho jaye. Dono mil kar zero-downtime updates guarantee karte hain.

**Q3: Container crash hone par Swarm khud kya karta hai?**
A: Restart policy (`on-failure`) ke mutabiq delay ke baad naya task schedule karta hai taake replicas ki desired count poori rahe. Tumhe manual `docker run` nahi karna parta — yehi reconciliation loop hai.

**Q4: Kubernetes seekhne se pehle Swarm kyun useful hai?**
A: Orchestration ke core concepts — desired state, scheduling, service discovery, rolling updates, healthchecks — dono me same hain. Swarm inko Docker CLI se 10 minute me sikha deta hai; phir Kubernetes ki complexity samajhna aasan ho jata hai.

## 🔜 Next Week

Week 5 me hum Compose ko pro level par le jayenge — multi-service apps, profiles, `depends_on` healthchecks, aur ek poora project: frontend + API + database, ek command me up!
