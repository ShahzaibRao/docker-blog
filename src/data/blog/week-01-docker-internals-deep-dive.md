---
author: Rao Shahzaib
pubDatetime: 2026-09-26T10:00:00Z
title: "Week 1: Docker Internals Deep Dive"
description: "Understand what Docker really is under the hood — image layers, OverlayFS, Linux namespaces, cgroups, and BuildKit — with hands-on labs."
tags: ["docker", "docker-360", "internals", "buildkit"]
---

> 🐳 **Docker 360 — Week 1 of 16** | Docker internals: layers, namespaces, cgroups aur BuildKit ko andar se samjho

## 🎯 Learning Objective

Docker commands to sab chala lete hain — `docker run`, `docker build`, `docker ps`. Lekin jab koi cheez toot ti hai, tab kaam aata hai **andar ki samajh**. Is week me tum seekho ge ke container asal me hai kya (hint: ye koi "halki VM" nahi), images layers me kaise banti hain, Linux kernel ke namespaces aur cgroups kaise isolation dete hain, aur BuildKit tumhare builds ko fast aur chhota kaise banata hai.

## 🎨 Visual Diagrams

### VMs vs Containers — architecture ka farq

```text
  VIRTUAL MACHINES                        CONTAINERS
  =================                        ==========

  ┌──────────────────────┐                ┌──────────────────────┐
  │      App A           │                │      App A           │
  │  ┌────────────────┐  │                │  ┌────────────────┐  │
  │  │   Guest OS     │  │                │  │  Libs / Deps   │  │
  │  │  (full kernel) │  │                └──────────────────────┘
  │  └────────────────┘  │                ┌──────────────────────┐
  │     Hypervisor       │                │      App B           │
  ├──────────────────────┤                │  ┌────────────────┐  │
  │      App B           │                │  │  Libs / Deps   │  │
  │  ┌────────────────┐  │                └──────────────────────┘
  │  │   Guest OS     │  │                ┌──────────────────────┐
  │  │  (full kernel) │  │                │   Container Engine   │
  │  └────────────────┘  │                │  (Docker + runc)     │
  │     Hypervisor       │                ├──────────────────────┤
  ├──────────────────────┤                │   Host OS (1 kernel) │
  │      Host OS         │                │   shared by all      │
  └──────────────────────┘                └──────────────────────┘

  Har VM apna kernel boot karti hai.   Sab containers HOST ka kernel share
  Iska matlab ye hai ke VMs heavy      karte hain — kernel dubara boot nahi
  hoti hain aur slow start hoti hain.  hota, is liye containers seconds
                                       me start hote hain.
```

### Image layers — har instruction ek layer

```text
  Dockerfile instructions          Image layers (read-only stack)
  =======================          ==============================

  FROM alpine:3.20          ──►   ┌─────────────────────────┐
                                  │ Layer 4: CMD ["sh"]     │  ◄── top layer
  RUN apk add curl          ──►   ├─────────────────────────┤
                                  │ Layer 3: + curl files   │
  COPY app.sh /app/         ──►   ├─────────────────────────┤
                                  │ Layer 2: + app.sh       │
  (base image)              ──►   ├─────────────────────────┤
                                  │ Layer 1: alpine base    │  ◄── bottom layer
                                  └─────────────────────────┘
                                           │
                                  Container start hone par is ke
                                  upar ek thin WRITABLE layer
                                  lagti hai (copy-on-write):

                                  ┌─────────────────────────┐
                                  │ Writable layer (thin)   │ ◄── container ke
                                  ├─────────────────────────┤    changes yahan
                                  │ Layer 4                 │
                                  │ Layer 3                 │
                                  │ Layer 2                 │
                                  │ Layer 1                 │
                                  └─────────────────────────┘
```

### OverlayFS — layers kaise "merge" hoti hain

```text
  lowerdir (read-only layers)          upperdir (writable)        merged (container dekhta hai)
  ===========================          ==================        ==============================

  /var/lib/docker/overlay2/            /var/lib/docker/          ┌──────────────────────┐
   ├─ l/ABC  (layer 1: base)            overlay2/                 │ /etc/app.conf        │
   ├─ l/DEF  (layer 2: +curl)           └─ XYZ/                  │   → version from     │
   └─ l/GHI  (layer 3: +app.sh)            ├─ diff/   (new       │     upperdir (nayi)  │
                                            │         files)     │ /usr/bin/curl        │
                                            └─ work/             │   → lowerdir se      │
                                                                 │ /bin/sh              │
  Kernel in sab ko ek hi mount                                    │   → lowerdir se      │
  point par "overlay" karke                                       └──────────────────────┘
  dikhata hai. Container ko lagta
  hai ke ye ek normal filesystem hai!
```

### BuildKit build pipeline

```text
  Dockerfile                  BuildKit (parallel + cached)
  ==========                  ============================

  FROM golang AS builder  ──► ┌──────────────┐
  COPY go.mod .                │ Stage: deps  │── cache mount: /go/pkg/mod
  RUN go mod download          └──────┬───────┘
                                      ▼
                              ┌──────────────┐
  COPY . .                     │ Stage: build │── cache mount: go build cache
  RUN go build -o app          └──────┬───────┘
                                      ▼
  FROM alpine             ──► ┌──────────────┐
  COPY --from=builder           │ Stage: final │── sirf binary copy hota hai
    /app/app /app               │ ~10 MB image │
                              └──────────────┘

  Purani builder har step serial chalata tha. BuildKit independent
  stages parallel chalata hai aur cache mounts se dubara download
  nahi karta. Iska matlab ye hai ke doosri build pehle se
  kaafi tez hoti hai.
```

## 🧠 Theory Deep Dive

### Docker asal me hai kya?

Docker teen cheezon ka combination hai — aur in me se koi bhi "Docker ki apni" magic nahi:

1. **Docker client + daemon (dockerd):** Tum `docker` command chalate ho, wo REST API par daemon se baat karta hai. Daemon images pull karta hai, containers banata hai, networks aur volumes manage karta hai.
2. **containerd + runc:** Daemon asal kaam containerd ko deta hai, jo low-level runtime `runc` se container processes start karta hai (OCI standard ke mutabiq).
3. **Linux kernel features:** namespaces (isolation) + cgroups (resource limits). Ye dono kernel me pehle se thay — Docker ne inko easy bana diya.

Iska matlab ye hai ke **container sirf ek isolated Linux process hai** — koi mini-VM nahi. `docker exec` karke `ps` chalao ge to host ke processes nazar nahi aayenge, lekin kernel wahi ek hai.

### Image layers aur copy-on-write

Har `RUN`, `COPY`, `ADD` instruction ek **nayi read-only layer** banati hai. Layers content-addressable hoti hain (SHA256 hash se pehchani jati hain), is liye do images jo same base use karti hain wo layers **share** karti hain — disk bachta hai.

Jab container start hota hai, image ke upar ek **thin writable layer** lagti hai. Container jo bhi file change karta hai, wo copy-on-write se pehle upar copy hoti hai phir modify hoti hai. Container delete → writable layer delete → image waisi ki waisi. Yahi wajah hai ke containers **ephemeral** hote hain: un me data store karna galat jagah hai (Week 3 me volumes dekhenge).

### Linux namespaces — isolation ka engine

Namespaces kernel ko kehte hain: "is process ko duniya ka ye hissa alag dikhao."

| Namespace | Kya isolate karta hai | Example |
|-----------|----------------------|---------|
| `pid` | Process IDs | Container me PID 1 tumhari app hai, host par nahi |
| `net` | Network interfaces, IPs, ports | Har container ka apna `eth0` aur IP |
| `mnt` | Mount points / filesystem view | Container ka `/` host ke `/` se alag |
| `uts` | Hostname | Container ka apna hostname |
| `ipc` | Inter-process communication | Shared memory alag |
| `user` | UIDs/GIDs | Container ka root host par normal user ho sakta hai |
| `cgroup` | Cgroup view | Container ko apni limits hi nazar aati hain |

Docker `docker run` karte waqt in namespaces ko automatically set karta hai. Lab me hum `unshare` command se khud ek namespace bana kar dekhenge.

### cgroups — resource limits ka engine

Namespaces **dikhne** wali duniya alag karte hain, cgroups **kitna use kar sakte ho** ye control karte hain: CPU shares, memory limits, block I/O, aur kitne processes (pids) chala sakte ho.

```bash
docker run -d --name limited --memory 256m --cpus 0.5 nginx:alpine
```

Is command ne kernel ko kaha: "is container ke processes 256 MB RAM aur aadha CPU core se zyada use na karen." Limit cross ho to OOM killer container ka process maar deta hai — container restart ho jata hai (agar restart policy lagi ho). Modern systems par cgroups **v2** use hota hai (`/sys/fs/cgroup` me unified hierarchy).

### BuildKit — modern builder

Classic builder purana aur slow hai. **BuildKit** (Docker 23+ me default) deta hai:

- **Multi-stage builds:** Ek Dockerfile me multiple `FROM` — pehle stage me compile karo, aakhri stage me sirf binary copy karo. Final image chhoti, build tools image me nahi aate.
- **Cache mounts (`RUN --mount=type=cache`):** Package caches (npm, pip, go modules) builds ke darmiyan persist rehte hain — dubara download nahi hota.
- **Parallel execution:** Independent stages ek sath chalte hain.
- **buildx:** Multi-platform images (`--platform linux/amd64,linux/arm64`) aur remote caching.

Har Dockerfile ke top par ye line BuildKit syntax extensions enable karti hai:

```dockerfile
# syntax=docker/dockerfile:1
```

## 💻 Hands-On Lab

> Lab machine: Linux with Docker installed. Tumhara user `docker` group me ho ya `sudo` use karo.

### Lab A — Image layers ko inspect karo

**Step 1: Ek image pull karo aur uski layers dekho.**

```bash
docker pull nginx:alpine
docker history nginx:alpine
```

✅ **Expected result:** Har layer ki `CREATED BY` command, size aur ek chhota sa ID nazar aayega. Sab se neechay wali layer base image ki hai, sab se upar wali `CMD` wali.

**Step 2: Layers ke content hashes dekho.**

```bash
docker inspect --format='{{range .RootFS.Layers}}{{println .}}{{end}}' nginx:alpine | head -10
```

✅ **Expected result:** `sha256:...` hashes ki list — yehi woh content-addressable layer IDs hain jo Docker disk par store karta hai (`/var/lib/docker/overlay2/` me).

**Step 3: Kitni layers share ho sakti hain, check karo.**

```bash
docker pull alpine:3.20
docker history alpine:3.20 | head -5
```

✅ **Expected result:** `nginx:alpine` aur `alpine:3.20` me common base layers nazar aayengi — Docker inko dubara download/store nahi karta. Disk bachat ka yehi raaz hai.

### Lab B — `unshare` se namespace khud banao

**Step 4: Mount namespace ka demo — isolated filesystem view.**

```bash
sudo unshare --mount bash -c 'mount -t tmpfs tmpfs /tmp/ns-demo 2>/dev/null || (mkdir -p /tmp/ns-demo && mount -t tmpfs tmpfs /tmp/ns-demo); echo "hello from isolated mount" > /tmp/ns-demo/file.txt; ls /tmp/ns-demo'
```

✅ **Expected result:** `file.txt` listed hota hai — namespace ke andar mount kamyab hua.

**Step 5: Ab host se check karo.**

```bash
ls /tmp/ns-demo 2>&1 || echo "host par kuch nahi hai"
```

✅ **Expected result:** Host par `/tmp/ns-demo` khaali ya missing hai. Iska matlab ye hai ke mount sirf us namespace ke andar hua tha — bilkul isi tarah Docker har container ko alag filesystem view deta hai.

### Lab C — BuildKit multi-stage build

**Step 6: Project setup.**

```bash
mkdir -p ~/week1-lab && cd ~/week1-lab
cat > main.go <<'EOF'
package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Assalamualaikum from Week 1 lab!")
	})
	http.ListenAndServe(":8080", nil)
}
EOF
cat > go.mod <<'EOF'
module week1lab

go 1.22
EOF
```

**Step 7: Multi-stage Dockerfile with cache mounts likho.**

```bash
cat > Dockerfile <<'EOF'
# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -o server .

FROM alpine:3.20
COPY --from=builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
EOF
```

**Step 8: Build karo (pehli baar — cache khaali hai).**

```bash
time DOCKER_BUILDKIT=1 docker build -t week1-app .
```

✅ **Expected result:** Build kamyab hoti hai. `builder` stage Go toolchain download karta hai (thoda time lagega pehli baar).

**Step 9: Dubara build karo — cache ka kamaal dekho.**

```bash
time DOCKER_BUILDKIT=1 docker build -t week1-app .
```

✅ **Expected result:** Doosri build dramatically tez hai — `CACHED` steps nazar aayenge. Cache mounts ne Go modules dubara download nahi hone diye.

**Step 10: Image size compare karo — multi-stage ka faida.**

```bash
docker images week1-app --format '{{.Repository}}:{{.Tag}} -> {{.Size}}'
docker history week1-app | head -8
```

✅ **Expected result:** Final image sirf ~15-20 MB (alpine + ek static binary). Agar hum builder stage ko hi final banate to image 300 MB+ hoti. `docker history` me sirf final stage ki layers hain — Go toolchain kahin nahi.

**Step 11: Chalao aur test karo.**

```bash
docker run -d --name week1-app -p 8080:8080 week1-app
curl -s http://localhost:8080
docker stop week1-app && docker rm week1-app
```

✅ **Expected result:** `Assalamualaikum from Week 1 lab!` response milta hai.

**Cleanup (optional):**

```bash
cd ~ && rm -rf ~/week1-lab
docker rmi week1-app
docker image prune -f
```

## ✅ Checkpoint

**Q1: Container aur VM me sab se bunyadi farq kya hai?**
A: VM apna poora guest OS aur kernel boot karti hai (hypervisor ke upar), jabke container host ka kernel share karta hai aur sirf ek isolated process hota hai. Is liye containers halke aur tez start hote hain.

**Q2: Image ki layers read-only kyun hoti hain, aur container ke changes kahan jate hain?**
A: Layers immutable/shareable hone ke liye read-only hain. Container start par image ke upar ek thin writable layer lagti hai — sare changes copy-on-write se us me jate hain. Container delete hone par wo layer bhi chali jati hai.

**Q3: Namespaces aur cgroups me farq batao.**
A: Namespaces **isolation** dete hain — process ko kya nazar aata hai (PID, network, mounts, hostname). cgroups **limits** lagate hain — kitne resources use kar sakte ho (CPU, memory, I/O).

**Q4: Multi-stage build se final image chhoti kaise hoti hai?**
A: Pehle stage(s) me compile/build tools use hote hain, aakhri stage me sirf `COPY --from=builder` se tayyar binary (ya artifacts) copy hote hain. Build tools aur source code final image me nahi jate.

## 🔜 Next Week

Week 2 me hum Docker networking ki gehrai me jayenge — bridge vs host vs overlay drivers, containers ka aapas me naam se baat karna (embedded DNS), iptables security, aur Traefik se reverse proxy lab!
