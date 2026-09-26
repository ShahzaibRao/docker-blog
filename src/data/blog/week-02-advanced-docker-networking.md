---
author: Rao Shahzaib
pubDatetime: 2026-09-27T10:00:00Z
title: "Week 2: Advanced Docker Networking"
description: "Master Docker network drivers — bridge, host, none, overlay, macvlan — embedded DNS, iptables security, and a Traefik reverse-proxy lab."
tags: ["docker", "docker-360", "networking", "traefik"]
---

> 🐳 **Docker 360 — Week 2 of 16** | Docker networking: drivers, embedded DNS, iptables aur Traefik reverse proxy

## 🎯 Learning Objective

Week 1 me hum ne containers ko andar se dekha. Ab sawal ye hai: **ye containers aapas me aur bahar ki duniya se baat kaise karte hain?** Is week me tum paanchon network drivers ko samjho ge, user-defined networks par embedded DNS ka lab karo ge, `iptables` rules se published ports ko secure karna seekho ge, aur aakhir me Traefik reverse proxy ke peechay do services chalao ge — bilkul production style me.

## 🎨 Visual Diagrams

### Default bridge network — packet ka safar

```text
  Container A (172.18.0.2)                Container B (172.18.0.3)
  ┌──────────────────────┐                ┌──────────────────────┐
  │       eth0           │                │       eth0           │
  └─────────┬────────────┘                └─────────┬────────────┘
            │  veth pair (virtual cable)            │  veth pair
  ┌─────────┴────────────┐                ┌─────────┴────────────┐
  │   veth12345          │                │   veth67890          │
  └─────────┬────────────┘                └─────────┬────────────┘
            └──────────────┬────────────────────────┘
                           ▼
                  ┌──────────────────┐
                  │  docker0 bridge  │   ◄── virtual switch (Layer 2)
                  │  172.18.0.1      │
                  └────────┬─────────┘
                           │  NAT (masquerade via iptables)
                           ▼
                  ┌──────────────────┐
                  │  Host eth0       │───► Internet
                  │  192.168.1.10    │
                  └──────────────────┘

  Har container ko ek veth pair milta hai — ek sira container ke
  andar (eth0), doosra host par bridge se jura hota hai. Bridge
  ek virtual switch ki tarah kaam karta hai.
```

### Network drivers ka comparison

```text
  DRIVER     SCOPE        ISOLATION           USE CASE
  ─────────────────────────────────────────────────────────────
  bridge     single host  har container ko    default choice,
             (default)    private IP          dev/test aur simple apps

  host       single host  koi isolation       max performance,
             nahi — host ka                    jab port conflicts
             network stack                     na hon (monitoring agents)

  none       single host  koi network nahi    security-sensitive
                                       jobs, custom networking

  overlay    multi-host   encrypted VXLAN     Docker Swarm /
             tunnel       across hosts        multi-node clusters

  macvlan    single host  container ko LAN    legacy apps jin ko
             (ya VLAN)    par real IP milti   real LAN IP chahiye
                         hai (host jaisa)
```

### Traefik reverse proxy — request ka flow

```text
  Browser
    │  Host: app1.local
    ▼
  ┌──────────────────────────────────────────────┐
  │  Traefik (:80)                               │
  │  - Docker socket se containers discover      │
  │    karta hai (labels parh kar)               │
  │  - Host header dekh kar route karta hai      │
  └──┬────────────────────────┬──────────────────┘
     │ Host: app1.local       │ Host: app2.local
     ▼                        ▼
  ┌─────────────┐        ┌─────────────┐
  │  app1       │        │  app2       │
  │  (whoami)   │        │  (whoami)   │
  │  internal   │        │  internal   │
  │  port 80    │        │  port 80    │
  └─────────────┘        └─────────────┘
     ▲                        ▲
     └──── sirf Traefik se baat ─────┘
           (ports publish nahi!)

  Services ke ports host par publish karne ki zaroorat nahi —
  Traefik Docker network ke andar hi un se baat karta hai.
```

## 🧠 Theory Deep Dive

### Bridge driver — sab se common

`docker run` bina `--network` ke jo network milta hai wo **default bridge** hai. Lekin ek catch hai: **default bridge par embedded DNS nahi chalta** — containers ek doosre ko naam se resolve nahi kar sakte, sirf IP se. Is liye best practice hai **user-defined bridge network** banana:

```bash
docker network create my-net
docker run -d --name web --network my-net nginx:alpine
```

User-defined bridge par Docker ka **embedded DNS server (127.0.0.11)** har container ke `/etc/resolv.conf` me lag jata hai, aur containers ek doosre ko **container name ya network alias** se resolve kar lete hain. Iska matlab ye hai ke IP yaad rakhne ki zaroorat nahi — naam hi kaafi hai.

### Host, none, overlay, macvlan — kab kya?

- **host:** Container host ka network stack directly use karta hai. `docker run --network host -d nginx` karne par nginx host ke port 80 par directly listen karega — koi NAT, koi port mapping nahi. Performance best, lekin port conflicts aur kam isolation. Swarm services me host mode bhi use hota hai.
- **none:** Container ka network stack khaali — sirf loopback. Custom CNI plugins ya maximum lockdown ke liye.
- **overlay:** Multi-host networking ke liye. Swarm cluster me do alag machines par chalne wale containers ek hi overlay network par aapas me baat kar sakte hain — VXLAN tunnels ke zariye, optional encryption ke sath.
- **macvlan:** Container ko tumhare physical LAN par ek **real IP** milti hai (jaise wo ek alag physical machine ho). DHCP bhi kaam karta hai. Legacy monitoring ya appliances ke liye useful.

### iptables aur Docker — published ports ki security

Docker daemon `iptables` rules khud manage karta hai — `DOCKER` aur `DOCKER-USER` chains ke zariye. **Ahem nuqta:** Tumhare normal `INPUT` chain rules Docker ke published ports par **apply nahi hote**, kyun ke Docker ke rules `FORWARD` chain me pehle match ho jate hain!

Is liye Docker ne **`DOCKER-USER`** chain banayi hai — ye woh jagah hai jahan tum apne custom firewall rules lagate ho, aur ye Docker ke apne rules se **pehle** evaluate hoti hai:

```text
  Packet flow for a published port (-p 8080:80):

  Internet ──► PREROUTING (DNAT 8080 → container IP:80)
                  │
                  ▼
            ┌─────────────┐
            │ DOCKER-USER │ ◄── TUMHARE rules yahan!
            │  (custom)   │     (Docker inko nahi chherta)
            └──────┬──────┘
                   ▼
            ┌─────────────┐
            │   DOCKER    │ ◄── Docker ke auto rules
            └──────┬──────┘
                   ▼
              container:80
```

Golden rule: **kabhi Docker ki banayi chains (DOCKER, DOCKER-ISOLATION) me haath se rule mat lagao** — daemon restart par wo reset ho jati hain. Sirf `DOCKER-USER` use karo.

### Traefik — dynamic reverse proxy

Nginx me har nayi service ke liye config file likhni parti hai aur reload karna parta hai. **Traefik** Docker daemon se baat karke containers ko **automatically discover** karta hai — container par lage **labels** parh kar routing rules bana leta hai. Container up/down ho to Traefik khud update ho jata hai, bina restart ke. Yehi isko container duniya ka favourite reverse proxy banata hai.

## 💻 Hands-On Lab

### Lab A — Embedded DNS: naam se baat

**Step 1: User-defined network banao aur do containers chalao.**

```bash
docker network create lab-net
docker run -d --name web --network lab-net nginx:alpine
docker run -d --name client --network lab-net alpine sleep 3600
```

**Step 2: Naam se resolve karo.**

```bash
docker exec client nslookup web
docker exec client ping -c 2 web
```

✅ **Expected result:** `nslookup` me `Address: 172.x.x.x` (embedded DNS 127.0.0.11 se jawab) aur ping kamyab. Iska matlab ye hai ke containers ko ek doosre ke IP yaad rakhne ki zaroorat nahi.

**Step 3: Default bridge par farq dekho.**

```bash
docker run -d --name plain-web nginx:alpine
docker run --rm nginx:alpine ping -c 1 plain-web || echo "naam se resolve NAHI hua (expected)"
```

✅ **Expected result:** Default bridge par naam resolution fail hoti hai — sirf IP se ping chalegi. Yehi wajah hai ke user-defined networks best practice hain.

**Step 4: Network inspect karo.**

```bash
docker network inspect lab-net --format='{{range .Containers}}{{println .Name .IPv4Address}}{{end}}'
```

✅ **Expected result:** Dono containers ke naam aur unke IPs ki list.

### Lab B — iptables: published port ko restrict karo

**Step 1: Ek service publish karo.**

```bash
docker run -d --name guarded -p 8080:80 nginx:alpine
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080
```

✅ **Expected result:** `200` — port publish ho gaya, sab se accessible hai.

**Step 2: DOCKER-USER chain dekho.**

```bash
sudo iptables -L DOCKER-USER -n -v
```

✅ **Expected result:** Chain exist karti hai (shayad khaali ho). Yehi tumhari custom rules ki jagah hai.

**Step 3: Sirf apni subnet ko allow karo, baqi sab block.**

```bash
# Pehle apni subnet nikalo (example: 192.168.1.0/24 — apne hisab se badlo)
ip -4 route show | grep -oP 'src \K[\d.]+'

sudo iptables -I DOCKER-USER -p tcp --dport 8080 -s 192.168.1.0/24 -j ACCEPT
sudo iptables -I DOCKER-USER -p tcp --dport 8080 -j DROP
sudo iptables -L DOCKER-USER -n --line-numbers
```

✅ **Expected result:** Do rules nazar aati hain — pehle subnet allow, phir sab ke liye DROP. (Note: apni machine ki asal subnet lagao; `curl localhost:8080` ab bhi chalega kyun ke localhost alag path se aata hai.)

**Step 4: Cleanup — rules hatao.**

```bash
sudo iptables -D DOCKER-USER -p tcp --dport 8080 -j DROP
sudo iptables -D DOCKER-USER -p tcp --dport 8080 -s 192.168.1.0/24 -j ACCEPT
docker stop guarded && docker rm guarded
```

✅ **Expected result:** Chain wapas khaali, container removed. Lab machine saaf.

### Lab C — Traefik reverse proxy

**Step 5: Compose project banao.**

```bash
mkdir -p ~/week2-lab && cd ~/week2-lab
cat > compose.yaml <<'EOF'
services:
  traefik:
    image: traefik:v3.1
    command:
      - --providers.docker=true
      - --entrypoints.web.address=:80
    ports:
      - "80:80"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  app1:
    image: traefik/whoami
    labels:
      - "traefik.http.routers.app1.rule=Host(`app1.local`)"
      - "traefik.http.routers.app1.entrypoints=web"

  app2:
    image: traefik/whoami
    labels:
      - "traefik.http.routers.app2.rule=Host(`app2.local`)"
      - "traefik.http.routers.app2.entrypoints=web"
EOF
docker compose up -d
```

✅ **Expected result:** Teenon containers running. Note karo: `app1`/`app2` ke **koi ports publish nahi** — sirf Traefik ka port 80 bahar hai.

**Step 6: Host header se routing test karo.**

```bash
curl -s -H "Host: app1.local" http://localhost | grep -i hostname
curl -s -H "Host: app2.local" http://localhost | grep -i hostname
```

✅ **Expected result:** Do alag hostnames — Traefik ne Host header dekh kar request sahi container ko bhej di. Koi nginx config reload nahi karna para!

**Step 7: Ek nayi service add karo — Traefik khud discover karega.**

```bash
docker run -d --label "traefik.http.routers.app3.rule=Host(\`app3.local\`)" \
  --label "traefik.http.routers.app3.entrypoints=web" \
  --network week2-lab_default traefik/whoami
sleep 3
curl -s -H "Host: app3.local" http://localhost | grep -i hostname
```

✅ **Expected result:** Teesri service foran reachable — Traefik ne Docker events sun kar route khud bana liya. Iska matlab ye hai ke nayi deployments ke liye proxy config haath se update karne ki zaroorat nahi.

**Cleanup:**

```bash
cd ~/week2-lab && docker compose down
docker stop plain-web web client 2>/dev/null; docker rm plain-web web client 2>/dev/null
docker network rm lab-net
docker rm -f $(docker ps -aq --filter "ancestor=traefik/whoami") 2>/dev/null
cd ~ && rm -rf ~/week2-lab
```

## ✅ Checkpoint

**Q1: Default bridge aur user-defined bridge me DNS ka kya farq hai?**
A: Default bridge par embedded DNS nahi hota — containers sirf IP se baat kar sakte hain. User-defined bridge par Docker ka embedded DNS (127.0.0.11) chalta hai, to containers ek doosre ko naam ya alias se resolve kar lete hain.

**Q2: Published port ko firewall karne ke liye kaunsi iptables chain use karni chahiye aur kyun?**
A: `DOCKER-USER` chain — kyun ke ye Docker ke apne auto-generated rules se pehle evaluate hoti hai, aur daemon restart par tumhare rules safe rehte hain. `DOCKER` chain me haath se changes mat karo.

**Q3: `host` network mode kab use karna chahiye?**
A: Jab maximum network performance chahiye aur port conflicts ka khatra na ho — jaise monitoring agents ya high-throughput services. Isolation kam milti hai, is liye soch samajh kar use karo.

**Q4: Traefik nginx se containers ke liye behtar kyun hai?**
A: Traefik Docker socket se containers ko automatically discover karta hai aur labels se routing rules bana leta hai — nayi service deploy hote hi route live ho jata hai, bina config file likhe ya reload kiye.

## 🔜 Next Week

Week 3 me hum data ko containers se bahar nikalenge — volumes vs bind mounts vs tmpfs, backup/restore strategies, aur PostgreSQL ka production-style persistent setup with healthchecks!
