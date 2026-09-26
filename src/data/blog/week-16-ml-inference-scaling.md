---
author: Rao Shahzaib
pubDatetime: 2026-09-26T00:00:00Z
title: "Week 16: Batch Jobs & Scaling Inference"
description: "Run one-shot batch containers, serve an ML model behind an API, scale it with replicas and a load balancer, and wrap up the complete 16-week Docker journey."
tags: ["docker", "docker-360", "ml", "scaling"]
---

> 🐳 **Docker 360 — Week 16 of 16** | Batch jobs, scaling inference & graduation 🎓

## 🎯 Learning Objective

Ye hamara aakhri week hai! Tum seekhoge ke **one-shot batch containers** se ETL-style jobs kaise chalaye jate hain, ek trained ML model ko **API container** ke peeche kaise serve kiya jata hai, aur **replicas + load balancer** se inference ko kaise scale kiya jata hai — ek simple load test ke sath. Aur end me poore 16-week safar ka wrap-up: tumne kya seekha aur agla qadam (Kubernetes, GitOps) kya hai.

## 🎨 Visual Diagrams

**One-shot batch job ka lifecycle:**

```text
  cron / scheduler ──trigger──►  docker run --rm etl-job
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │  container runs  │
                                    │  extract →       │
                                    │  transform →     │
                                    │  load → exit 0   │
                                    └──────────────────┘
                                              │
                                     --rm: khud delete ✓
                                              │
                                              ▼
                                    logs me result, koi
                                    leftover container nahi
```

**Scaled inference ke peeche load balancer:**

```text
                    ┌─────────────────────────────────┐
  clients ─────────►│  nginx (load balancer, :8080)   │
                    └────────┬────────────────────────┘
                             │  round-robin
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ api-1    │   │ api-2    │   │ api-3    │
        │ :8000    │   │ :8000    │   │ :8000    │
        │ model 🧠 │   │ model 🧠 │   │ model 🧠 │
        └──────────┘   └──────────┘   └──────────┘
        (docker compose up --scale api=3)
```

## 🧠 Theory Deep Dive

### One-shot containers (`--rm`)

Har container hamesha chalti hui service nahi hoti. Batch jobs — data processing, backups, nightly reports — **chal kar khatam** hone wale containers hain. `--rm` flag container ke exit hote hi use delete kar deta hai, taake `docker ps -a` me murda containers ka dher na lage. Scheduling ke liye host ka **cron**, **systemd timer**, ya orchestrator (Kubernetes CronJob) use hota hai — container khud schedule nahi karta, wo sirf kaam karta hai.

### Model serving pattern

ML model ko serve karne ka standard tareeqa: model file (`.pkl`) ko image me bake karo ya volume se mount karo, ek lightweight API (FastAPI) usay load kare, aur `/predict` endpoint expose kare. Har replica **stateless** hoti hai — isi liye unhe scale karna aasan hai: kaam ka bojh kitna bhi ho, replicas barha do.

### Scaling with Compose

`docker compose up --scale api=3` ek service ke 3 containers bana deta hai. **Ehm khayal rahe:** scaled service par host port publish nahi kar sakte (3 containers ek hi host port ke liye larhenge). Isi liye aage **nginx** jaisa load balancer lagate hain — wo ek port sunta hai aur requests replicas me baant deta hai. Compose ke andar service naam (`api`) se DNS round-robin hota hai.

## 💻 Hands-On Lab

### Lab 1 — One-shot batch job

**Step 1:** Ek ETL-style script banao:

```bash
mkdir -p /tmp/batch-lab && cd /tmp/batch-lab
cat > etl.py <<'EOF'
import datetime, json

print("extracting...")
raw = [{"id": i, "value": i * 10} for i in range(1, 6)]

print("transforming...")
clean = [{"id": r["id"], "value": r["value"], "doubled": r["value"] * 2} for r in raw]

print("loading...")
with open("/output/result.json", "w") as f:
    json.dump({"ran_at": datetime.datetime.utcnow().isoformat(), "rows": clean}, f, indent=2)

print(f"done: {len(clean)} rows written")
EOF
mkdir -p output
```

**Step 2:** One-shot run:

```bash
docker run --rm -v /tmp/batch-lab:/work -v /tmp/batch-lab/output:/output -w /work python:3.12-slim python etl.py
cat output/result.json
```

✅ **Expected result:** `done: 5 rows written` aur `result.json` me 5 transformed rows. Phir `docker ps -a` me koi leftover container nahi milega — `--rm` ne safai kar di.

**Step 3:** Scheduling note — isay nightly chalana ho to host cron me:

```bash
# crontab -e me ye line (roz raat 2 baje):
# 0 2 * * * docker run --rm -v /tmp/batch-lab:/work -v /tmp/batch-lab/output:/output -w /work python:3.12-slim python etl.py >> /var/log/etl.log 2>&1
```

### Lab 2 — Model training (pickle banao)

**Step 1:** (Host par `pip install scikit-learn` chahiye)

```bash
mkdir -p /tmp/serve-lab/app && cd /tmp/serve-lab
cat > train_model.py <<'EOF'
import pickle
from sklearn.datasets import load_iris
from sklearn.linear_model import LogisticRegression

X, y = load_iris(return_X_y=True)
model = LogisticRegression(max_iter=200)
model.fit(X, y)
with open("app/model.pkl", "wb") as f:
    pickle.dump(model, f)
print("model saved -> app/model.pkl")
EOF
python train_model.py
```

### Lab 3 — API container

**Step 2:** `app/main.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel
import pickle, socket

with open("model.pkl", "rb") as f:
    model = pickle.load(f)

app = FastAPI()
host = socket.gethostname()

class Features(BaseModel):
    features: list[float]

@app.post("/predict")
def predict(payload: Features):
    pred = model.predict([payload.features])[0]
    return {"prediction": int(pred), "served_by": host}

@app.get("/health")
def health():
    return {"status": "ok", "served_by": host}
```

**Step 3:** `app/requirements.txt`:

```text
fastapi
uvicorn[standard]
scikit-learn
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

### Lab 4 — Scale + load balancer

**Step 5:** `nginx.conf`:

```nginx
events {}

http {
    upstream api {
        server api:8000;
    }

    server {
        listen 8080;

        location / {
            proxy_pass http://api;
        }
    }
}
```

**Step 6:** `compose.yaml`:

```yaml
services:
  api:
    build: .
    expose:
      - "8000"
  nginx:
    image: nginx:alpine
    ports:
      - "8080:8080"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api
```

**Step 7:** 3 replicas ke sath up karo:

```bash
docker compose up --build -d --scale api=3
sleep 10
docker compose ps
```

✅ **Expected result:** `api-1`, `api-2`, `api-3` aur `nginx-1` — 4 containers running.

**Step 8:** Inference test:

```bash
curl -s -X POST localhost:8080/predict -H 'Content-Type: application/json' \
  -d '{"features":[5.1,3.5,1.4,0.2]}'
```

✅ **Expected result:** `{"prediction":0,"served_by":"..."}` — model ne jawab diya!

### Lab 5 — Simple load test: distribution dekho

**Step 9:** 60 requests bhejo aur dekho load bant-ta hai ya nahi:

```bash
for i in $(seq 1 60); do
  curl -s -X POST localhost:8080/predict -H 'Content-Type: application/json' \
    -d '{"features":[5.1,3.5,1.4,0.2]}'
  echo
done | grep -o '"served_by":"[^"]*"' | sort | uniq -c
```

✅ **Expected result:** Teenon replicas me lagbhag barabar taqseem — jaise `20 api-1`, `20 api-2`, `20 api-3` (thoda upar neeche ho sakta hai). Yehi **load balancing ka saboot** hai: nginx requests ko round-robin baant raha hai.

**Step 10:** Scale down karke farq dekho:

```bash
docker compose up -d --scale api=1
sleep 5
docker compose ps --format '{{.Name}}'
```

✅ **Expected result:** Sirf ek `api` container reh jayega — scaling dono direction me kaam karti hai.

**Step 11:** Safai:

```bash
docker compose down --rmi local -v
```

## ✅ Checkpoint

**Q1: Batch job containers me `--rm` kyun lagate hain?**
A: Taake job complete hote hi container auto-delete ho jaye — warna har run ek murda container chhor jayega aur `docker ps -a` bhar jayega.

**Q2: Scaled service (`--scale api=3`) par host port publish kyun nahi kar sakte?**
A: Kyunke 3 containers ek hi host port ke liye larhenge — port conflict hoga. Isi liye aage load balancer lagate hain jo ek port sunta hai.

**Q3: Load test me `served_by` field ka kya maqsad tha?**
A: Ye batata hai ke kaunsi replica ne request handle ki — is se verify hota hai ke nginx requests ko replicas me baant raha hai, sab ek par nahi aa rahe.

**Q4: Inference replicas ko stateless rakhna kyun zaroori hai?**
A: Taake koi bhi replica kisi bhi request ko handle kar sake — phir replicas add/remove karna safe hai aur load balancer ko koi farq nahi parhta.

## 🎓 Course Wrap-Up — 16 Weeks Complete!

Mubarak ho! 🎉 Tumne **Docker 360** ka poora safar tay kar liya. Ek nazar peeche:

| Weeks | Kya seekha |
|---|---|
| 1–4 | Docker basics — containers vs VMs, images, Dockerfile, CLI |
| 5–8 | Volumes, bind mounts, networking, Compose multi-container apps |
| 9–12 | Registries, security best practices, CI pipelines, monitoring |
| 13 | Docker-in-Docker workflows aur CI builds |
| 14 | Team dev environments, override files, seeded databases |
| 15 | GPU containers, CUDA images, MLflow experiment tracking |
| 16 | Batch jobs, model serving, scaling inference |

Tum ab containers **chalana**, **banana**, **secure karna**, **scale karna** aur **ML workloads** par lagana — sab jante ho. Ye wo skill set hai jo real DevOps roles me roz kaam aata hai.

### Agla qadam — yahan se kahan?

- ☸️ **Kubernetes:** Jab ek host kafi na ho — pods, deployments, services. Docker ki concepts wahan seedha kaam aayengi.
- 🔄 **GitOps:** Argo CD ya Flux se Git ko deployment ka single source of truth banao.
- 🔒 **Security deep-dive:** Image scanning (Trivy), rootless containers, secrets management (Vault).
- 📦 **Production hardening:** Resource limits, healthchecks, logging pipelines — isi blog ke patterns ko prod me le jao.

Seekhte raho, labs karte raho — aur yaad rakho: **"Jo samjhay wohi sikhtay hain."** Shukriya ke tum is safar me sath rahe! 🚀🐳
