---
author: Rao Shahzaib
pubDatetime: 2026-09-13T00:00:00Z
title: "Week 3: Persistent Storage Mastery"
description: "Master Docker storage — volumes vs bind mounts vs tmpfs decision guide, volume backup & restore lab, and a production-style PostgreSQL setup."
tags: ["docker", "docker-360", "volumes", "postgres"]
---

> 🐳 **Docker 360 — Week 3 of 16** | Persistent storage: volumes, bind mounts, tmpfs aur PostgreSQL ka production setup

## 🎯 Learning Objective

Week 1 me hum ne dekha tha: container ka writable layer **ephemeral** hai — container gaya, data gaya. Real duniya me databases, uploads aur configs ko persist karna parta hai. Is week me tum teeno storage options (volumes, bind mounts, tmpfs) ke darmiyan sahi faisla karna seekho ge, volume backup/restore ka lab karo ge, aur PostgreSQL ko named volume + init scripts + healthcheck ke sath production style me chalao ge.

## 🎨 Visual Diagrams

### Storage options — data kahan rehta hai?

```text
  ┌─────────────────────────────────────────────────────────────┐
  │                        HOST MACHINE                         │
  │                                                             │
  │  /var/lib/docker/volumes/        /home/user/project/        │
  │   └─ pgdata/                     └─ config/                 │
  │       └─ _data/  ◄── VOLUME           └─ app.conf ◄── BIND  │
  │            │  (Docker manage                          MOUNT │
  │            │   karta hai)                        (tum manage│
  │            │                                      karte ho)│
  │            ▼                                               │
  │  ┌──────────────────┐        ┌──────────────────┐           │
  │  │   Container      │        │   Container      │           │
  │  │  /var/lib/       │        │  /etc/app/       │           │
  │  │  postgresql/data │        │   app.conf       │           │
  │  └──────────────────┘        └──────────────────┘           │
  │                                                             │
  │  ┌──────────────────┐                                       │
  │  │   Container      │   tmpfs: sirf RAM me, container       │
  │  │  /run/secrets ── │   stop hote hi data GONE. Secrets     │
  │  │  (RAM only!)     │   aur temp caches ke liye.            │
  │  └──────────────────┘                                       │
  └─────────────────────────────────────────────────────────────┘
```

### Volume backup & restore flow

```text
  BACKUP                                    RESTORE
  ======                                    =======

  ┌──────────────┐                          ┌──────────────┐
  │ volume       │                          │ tarball      │
  │ "appdata"    │                          │ appdata.tgz  │
  │  ┌────────┐  │   tar czf                │  ┌────────┐  │   tar xzf
  │  │notes.txt│──┼────────► appdata.tgz ───┼─►│notes.txt│──┼────────►
  │  └────────┘  │                          │  └────────┘  │   new volume
  └──────────────┘                          └──────────────┘   "appdata2"

  Helper container:                         Helper container:
  --rm -v appdata:/data                     --rm -v appdata2:/data
  -v $(pwd):/backup                         -v $(pwd):/backup
  alpine tar czf /backup/...                alpine tar xzf /backup/...

  Trick ye hai ke backup ke liye app container ko rokne ki
  zaroorat nahi — ek chhota helper container volume mount
  karke tar bana leta hai.
```

### PostgreSQL lab architecture

```text
  ┌──────────────────────────────────────────────────┐
  │  docker compose (week3-lab)                      │
  │                                                  │
  │  ┌────────────────────────────┐                  │
  │  │ db (postgres:16-alpine)    │                  │
  │  │  :5432 (internal only)     │                  │
  │  │                            │                  │
  │  │  /var/lib/postgresql/data ─┼──► volume: pgdata│
  │  │  /docker-entrypoint-        │    (PERSISTENT!) │
  │  │   initdb.d/init.sql ───────┼──► bind mount    │
  │  │                            │    ./init.sql    │
  │  │  healthcheck: pg_isready   │    (first boot   │
  │  └────────────────────────────┘     par chalta   │
  │                                      hai)        │
  └──────────────────────────────────────────────────┘

  compose down karne par bhi pgdata volume rehta hai —
  dubara up karne par data wapas milta hai. Iska matlab
  ye hai ke database containers ke sath "mar" nahi jati.
```

## 🧠 Theory Deep Dive

### Decision guide — kab kya use karo?

|  | Volumes | Bind mounts | tmpfs |
|---|---|---|---|
| **Manage kaun karta hai** | Docker (`/var/lib/docker/volumes/`) | Tum (koi bhi host path) | Kernel (RAM) |
| **Best for** | Databases, app data — production default | Dev me live code reload, config files | Secrets, temp caches |
| **Backup** | Easy (helper container + tar) | Normal file copy | N/A — RAM hai |
| **Performance** | Storage driver bypass — fast | Host filesystem speed | Sab se tez (RAM) |
| **Portability** | Compose/swarm me best | Host path har machine par hona chahiye | Sirf Linux |
| **Example** | `-v pgdata:/var/lib/postgresql/data` | `-v ./src:/app` | `--tmpfs /run/secrets` |

**Rule of thumb:** Production data → **named volumes**. Development me code edit karna → **bind mounts**. Sensitive temp data → **tmpfs**. Random host paths par data rakhna (anonymous volumes se bacho — `docker volume ls` me dangling volumes ka dher lag jata hai).

### Named vs anonymous volumes

```bash
docker run -d -v pgdata:/var/lib/postgresql/data postgres:16-alpine   # NAMED ✓
docker run -d -v /var/lib/postgresql/data postgres:16-alpine          # ANONYMOUS ✗
```

Anonymous volumes ko random hash naam milta hai — container delete hone ke baad wo orphan reh jate hain aur pata nahi chalta ke kis ka data tha. Hamesha naam do.

### Init scripts — database ka pehla din

Postgres (aur MySQL) images ka entrypoint `/docker-entrypoint-initdb.d/` folder me rakhi `.sql`, `.sh` ya `.sql.gz` files ko **sirf pehli baar** (jab data directory khaali ho) chalata hai. Iska matlab ye hai ke schema aur seed data version-controlled files me rehta hai — container dubara banao, database khud tayyar.

### Healthchecks — "running" vs "ready"

Container `running` hai iska matlab ye nahi ke app **ready** hai — database ko 5-10 second lagte hain. Healthcheck Docker ko batata hai ke asal me service healthy hai ya nahi:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U labuser -d labdb"]
  interval: 5s
  timeout: 3s
  retries: 5
  start_period: 10s
```

Compose me doosri services `depends_on` with `condition: service_healthy` laga kar database ke ready hone ka **wait** kar sakti hain — race conditions khatam.

### Storage performance notes

- **Volumes storage driver ko bypass karte hain** — isi liye database workloads par volumes bind mounts se consistently behtar perform karte hain (overlayfs ka copy-up overhead nahi).
- **OverlayFS copy-up cost:** Writable layer me pehli baar file modify karne par poori file copy hoti hai — bari files (DB files!) par ye mehenga hai. Isi liye database data **kabhi** container layer me nahi, hamesha volume me.
- **tmpfs mounts** RAM me hote hain — secrets aur high-churn temp files ke liye ideal, lekin memory limit ka khayal rakho.
- Production me volume drivers (NFS, cloud block storage) se volumes multiple hosts par share ho sakte hain — Swarm/Kubernetes me isi ka use hota hai.

## 💻 Hands-On Lab

### Lab A — Volume backup & restore

**Step 1: Named volume banao aur us me data likho.**

```bash
docker volume create appdata
docker run --rm -v appdata:/data alpine sh -c 'echo "ye mera important data hai" > /data/notes.txt && echo "doosri line" >> /data/notes.txt'
docker run --rm -v appdata:/data alpine cat /data/notes.txt
```

✅ **Expected result:** Dono lines print hoti hain — data volume me persist hai, container to kab ka delete ho chuka (`--rm`).

**Step 2: Helper container se backup (tar) banao.**

```bash
mkdir -p ~/week3-lab && cd ~/week3-lab
docker run --rm -v appdata:/data -v "$(pwd)":/backup alpine tar czf /backup/appdata-backup.tar.gz -C /data .
ls -lh appdata-backup.tar.gz
```

✅ **Expected result:** `appdata-backup.tar.gz` file banti hai. App container ko rokna nahi para — helper ne volume mount karke backup le liya.

**Step 3: Disaster simulate karo — volume delete!**

```bash
docker volume rm appdata
docker volume ls | grep appdata || echo "volume gaya!"
```

✅ **Expected result:** Volume list me nahi hai. (Real life me yehi woh lamha hai jab dil ki dharkan tez hoti hai.)

**Step 4: Restore karo — naya volume, backup se data wapas.**

```bash
docker volume create appdata-restored
docker run --rm -v appdata-restored:/data -v "$(pwd)":/backup alpine tar xzf /backup/appdata-backup.tar.gz -C /data
docker run --rm -v appdata-restored:/data alpine cat /data/notes.txt
```

✅ **Expected result:** Dono lines wapas! Backup/restore ka poora cycle kamyab. Ghabrana nahi tha — backup tha na.

### Lab B — PostgreSQL: persistent + init scripts + healthcheck

**Step 5: Init script likho.**

```bash
cat > init.sql <<'EOF'
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT
);
INSERT INTO students (name, city) VALUES
  ('Ali', 'Lahore'),
  ('Fatima', 'Karachi')
ON CONFLICT DO NOTHING;
EOF
```

**Step 6: Compose file banao.**

```bash
cat > compose.yaml <<'EOF'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: labuser
      POSTGRES_PASSWORD: labpass123
      POSTGRES_DB: labdb
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U labuser -d labdb"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

volumes:
  pgdata:
EOF
docker compose up -d
```

✅ **Expected result:** Container start hota hai. Pehli baar init script chal kar table + seed data banata hai.

**Step 7: Healthy hone ka wait karo aur data verify karo.**

```bash
sleep 12
docker compose ps
docker exec week3-lab-db-1 psql -U labuser -d labdb -c "SELECT * FROM students;"
```

✅ **Expected result:** `ps` me status `healthy` (running ke sath), aur query me Ali/Fatima ki rows. (Container ka naam `docker compose ps` se confirm kar lo — folder ke naam par mabni hota hai.)

**Step 8: Naya data insert karo, phir container ura do.**

```bash
docker exec week3-lab-db-1 psql -U labuser -d labdb -c "INSERT INTO students (name, city) VALUES ('Usman', 'Islamabad');"
docker compose down
docker compose up -d
sleep 12
docker exec week3-lab-db-1 psql -U labuser -d labdb -c "SELECT * FROM students;"
```

✅ **Expected result:** Teeno rows maujood — `down` ke baad bhi data mehfooz, kyun ke wo volume `pgdata` me hai, container me nahi. **Yehi volumes ka asal power hai.**

**Step 9: Healthcheck ka status dekho.**

```bash
docker inspect week3-lab-db-1 --format='{{json .State.Health.Status}}'
```

✅ **Expected result:** `"healthy"` — Docker khud monitor kar raha hai ke postgres asal me jawab de raha hai.

**Cleanup:**

```bash
cd ~/week3-lab && docker compose down -v
docker volume rm appdata-restored
cd ~ && rm -rf ~/week3-lab
```

## ✅ Checkpoint

**Q1: Named volumes, bind mounts aur tmpfs me se database ke liye kya best hai aur kyun?**
A: **Named volumes** — Docker inko manage karta hai, ye storage driver ko bypass karte hain (behtar I/O performance), portable hain, aur backup/restore easy hai. Bind mounts dev ke liye, tmpfs RAM-only temp data ke liye.

**Q2: Anonymous volumes se kyun bachna chahiye?**
A: Inko random hash naam milta hai — container delete hone ke baad orphan volumes reh jate hain, pata nahi chalta ke data kis ka tha. `docker volume ls` kachre se bhar jata hai.

**Q3: `/docker-entrypoint-initdb.d/` me rakhi SQL files kab chalti hain?**
A: Sirf **pehli baar**, jab data directory bilkul khaali ho. Pehle se initialized volume par dubara nahi chalti — is liye schema changes ke liye migrations use karo.

**Q4: Healthcheck `depends_on` ke sath mil kar kya problem solve karta hai?**
A: Race condition — app container database ke ready hone se pehle start ho kar crash ho jata hai. Healthcheck + `service_healthy` condition se dependent service tab hi start hoti hai jab database asal me connections accept kar raha ho.

## 🔜 Next Week

Week 4 me hum single container se bahar niklenge — Docker Swarm par cluster banao, services ko scale karo, rolling updates aur auto-recovery ka lab karo. Orchestration ki duniya me khush aamdeed!
