---
author: Rao Shahzaib
pubDatetime: 2026-09-25T00:00:00Z
title: "Week 15: GPU Containers & MLflow"
description: "Run GPU workloads in Docker with the NVIDIA Container Toolkit, test CUDA inside containers, and track ML experiments with an MLflow server on Compose."
tags: ["docker", "docker-360", "gpu", "mlflow"]
---

> 🐳 **Docker 360 — Week 15 of 16** | GPUs in containers + experiment tracking

## 🎯 Learning Objective

Machine learning ka kaam GPUs ke baghair adhura hai — aur GPUs ka setup "meray machine par CUDA version mismatch hai" wali museebat ke liye mashhoor hai. Is week me tum **NVIDIA Container Toolkit** se GPU ko container ke andar expose karna seekhoge, **CUDA base images** ke tags samjhoge, `nvidia-smi` ko container me chala kar verify karoge, aur **MLflow tracking server** ko Compose par khada karke ek sample experiment log karoge. End tak tumhare paas ek reproducible ML lab hoga.

## 🎨 Visual Diagrams

**GPU access ka rasta — host se container tak:**

```text
  Host Machine (NVIDIA GPU + driver installed)
  ┌────────────────────────────────────────────────────┐
  │  NVIDIA driver (kernel level — host par hi hota   │
  │  hai, container me driver install NAHI hota!)      │
  │                                                    │
  │  NVIDIA Container Toolkit                          │
  │   (nvidia-container-runtime: GPU devices ko        │
  │    container me "inject" karta hai)                │
  │                                                    │
  │  ┌──────────────────────────────────────────────┐ │
  │  │  Container  (nvidia/cuda:xx.x-base)          │ │
  │  │   ┌────────────────────────────────────┐    │ │
  │  │   │  CUDA libraries (user-space)       │    │ │
  │  │   │  /dev/nvidia0  ◄── toolkit se aya  │    │ │
  │  │   │  nvidia-smi  ✓  torch.cuda ✓       │    │ │
  │  │   └────────────────────────────────────┘    │ │
  │  └──────────────────────────────────────────────┘ │
  └────────────────────────────────────────────────────┘

  Golden rule: driver HOST par, CUDA libraries CONTAINER me.
```

**MLflow tracking ka flow:**

```text
  ┌──────────────────┐   log_param/log_metric   ┌──────────────────┐
  │  training        │ ────────────────────────► │  mlflow server   │
  │  container       │   http://mlflow:5000      │  (compose)       │
  │  (train.py)      │                           │                  │
  └──────────────────┘                           │  ┌────────────┐ │
                                                 │  │ mlflow.db  │ │  params,
                                                 │  │ (sqlite)   │ │  metrics
                                                 │  ├────────────┤ │
                                                 │  │ artifacts/ │ │  models,
                                                 │  │ (volume)   │ │  plots
                                                 │  └────────────┘ │
                                                 └──────────────────┘
                                                        │ UI :5000
                                                        ▼
                                                 browser me compare karo 📊
```

## 🧠 Theory Deep Dive

### NVIDIA Container Toolkit kya karta hai?

Toolkit me do hisse hain: **driver-level** kaam host par pehle se hota hai (tumhe host par NVIDIA driver install karna hi parhta hai), aur **`nvidia-container-runtime`** container start hote waqt GPU device nodes (`/dev/nvidia0`, etc.) aur driver libraries ko container ke andar mount kar deta hai. Tumhe container me driver install karne ki zaroorat **nahi** — sirf user-space CUDA libraries chahiye hoti hain, jo CUDA base images me pehle se hoti hain.

Naye Docker versions me ye **CDI (Container Device Interface)** ke zariye bhi hota hai, lekin `--gpus all` flag sab se simple tareeqa hai aur wahi hum lab me use karenge.

### CUDA image tags — base vs runtime vs devel

| Tag suffix | Kya included hai | Kab use karo |
|---|---|---|
| `nvidia/cuda:12.4.1-base-ubuntu22.04` | Sirf CUDA runtime libs (minimal) | GPU check, chhoti utilities |
| `...-runtime-...` | Base + extra math libs (cuDNN etc.) | Inference / PyTorch runtime images |
| `...-devel-...` | Runtime + compilers, headers (`nvcc`) | Khud CUDA code compile karna ho |

Iska matlab ye hai ke production inference ke liye `runtime` kafi hai — `devel` image be-wajah bhaari hogi.

### MLflow ke 3 core concepts

- **Tracking:** har run ke params, metrics aur artifacts ek central server par log hote hain.
- **Backend store:** metadata kahan save hogi — hum SQLite file use karenge (volume par, taake restart par data na urhe).
- **Artifact store:** models aur files kahan save honge — ek named volume.

### ⚠️ Common gotchas

- **"could not select device driver nvidia"** — iska matlab NVIDIA Container Toolkit install nahi hai ya Docker daemon restart nahi hua. Toolkit install karke `sudo systemctl restart docker` chalao.
- **WSL2 users:** Docker Desktop ke bajaye WSL2 me native Docker + toolkit zyada reliable hai GPU ke liye.
- **Image size:** `pytorch/pytorch` CUDA images kai GB ki hoti hain — pehli pull me waqt lagega, ghabrana nahi.
- **MLflow artifacts bahar se:** agar training container alag host par ho, to `--default-artifact-root` ko S3 jaisi shared storage par point karo, local volume par nahi.

## 💻 Hands-On Lab

> **Note:** GPU labs ke liye host par NVIDIA GPU + driver + NVIDIA Container Toolkit installed hona chahiye. Agar GPU nahi hai, to MLflow wala hissa (Lab 3-4) phir bhi poora kar sakte ho — wo CPU par chalta hai.

### Lab 1 — Toolkit check

**Step 1:** Verify karo ke Docker GPU dekh sakta hai:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
```

✅ **Expected result:** Tumhare GPU ka naam, driver version aur memory — container ke andar se! Agar error aaye to toolkit install nahi hai.

**Step 2:** (Optional, bhaari image) PyTorch se CUDA test:

```bash
docker run --rm --gpus all pytorch/pytorch:2.5.0-cuda12.4-cudnn9-runtime \
  python -c "import torch; print('cuda available:', torch.cuda.is_available()); print('device:', torch.cuda.get_device_name(0))"
```

✅ **Expected result:** `cuda available: True` aur GPU ka naam.

### Lab 2 — Khud GPU test image banao

**Step 1:**

```bash
mkdir -p /tmp/gpu-lab && cd /tmp/gpu-lab
cat > Dockerfile <<'EOF'
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
CMD ["nvidia-smi", "-L"]
EOF
docker build -t gpu-test .
```

**Step 2:**

```bash
docker run --rm --gpus all gpu-test
```

✅ **Expected result:** `GPU 0: <tumhara GPU naam>` — tumhari apni built image GPU dekh rahi hai.

### Lab 3 — MLflow server on Compose

**Step 1:** Project banao:

```bash
mkdir -p /tmp/mlflow-lab && cd /tmp/mlflow-lab
cat > Dockerfile.mlflow <<'EOF'
FROM python:3.11-slim
RUN pip install --no-cache-dir "mlflow==2.16.0"
EXPOSE 5000
CMD ["mlflow", "server", "--host", "0.0.0.0", "--port", "5000", \
     "--backend-store-uri", "sqlite:////mlflow/mlflow.db", \
     "--default-artifact-root", "/mlflow/artifacts"]
EOF
```

**Step 2:** `compose.yaml`:

```yaml
services:
  mlflow:
    build:
      context: .
      dockerfile: Dockerfile.mlflow
    ports:
      - "5000:5000"
    volumes:
      - mlflow-data:/mlflow

volumes:
  mlflow-data:
```

**Step 3:** Start karo:

```bash
docker compose up --build -d
sleep 10
curl -s localhost:5000/ | head -c 200; echo
```

✅ **Expected result:** HTML response — MLflow UI `http://localhost:5000` par live hai. Browser me kholo to khaali experiments list nazar aayegi.

### Lab 4 — Sample experiment log karo

**Step 1:** Training script likho (host par venv ya system python me `pip install mlflow scikit-learn` chahiye):

```bash
pip install -q mlflow scikit-learn
cat > train.py <<'EOF'
import mlflow
from sklearn.datasets import load_iris
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

mlflow.set_tracking_uri("http://localhost:5000")
mlflow.set_experiment("iris-baseline")

X, y = load_iris(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, random_state=42)

for C in [0.1, 1.0, 10.0]:
    with mlflow.start_run(run_name=f"C={C}"):
        model = LogisticRegression(C=C, max_iter=200)
        model.fit(X_train, y_train)
        acc = accuracy_score(y_test, model.predict(X_test))
        mlflow.log_param("C", C)
        mlflow.log_metric("accuracy", acc)
        mlflow.sklearn.log_model(model, "model")
        print(f"C={C} -> accuracy={acc:.4f}")
EOF
python train.py
```

✅ **Expected result:** Teenon runs ke accuracy scores print honge, aur MLflow UI me `iris-baseline` experiment ke andar 3 runs — params, metrics aur saved models ke sath. Har run compare ki ja sakti hai!

**Step 2:** Data persist hai ye verify karo — server restart karke dekho:

```bash
docker compose restart
sleep 8
curl -s "localhost:5000/api/2.0/mlflow/experiments/search" | head -c 300; echo
```

✅ **Expected result:** Experiment ab bhi mojood hai — volume ki wajah se restart par data nahi urha.

**Step 3:** (GPU walo ke liye bonus) Training ko GPU container me chalao:

```bash
docker run --rm --gpus all --network host \
  -v /tmp/mlflow-lab:/work -w /work \
  pytorch/pytorch:2.5.0-cuda12.4-cudnn9-runtime \
  python -c "import torch; print(torch.cuda.get_device_name(0))"
```

**Step 4:** Safai:

```bash
cd /tmp/mlflow-lab && docker compose down -v
```

## ✅ Checkpoint

**Q1: GPU container me NVIDIA driver install karne ki zaroorat kyun nahi hoti?**
A: Kyunke driver kernel-level host par hota hai; NVIDIA Container Toolkit sirf device nodes aur user-space libraries ko container me expose karta hai.

**Q2: `nvidia/cuda` ke `base`, `runtime` aur `devel` tags me kya farq hai?**
A: Base minimal hai, runtime me inference libraries (cuDNN waghera) hoti hain, devel me compilers/headers (`nvcc`) — devel sirf tab jab khud CUDA code compile karna ho.

**Q3: MLflow me backend store aur artifact store me kya farq hai?**
A: Backend store (humari sqlite file) me params/metrics ka metadata hota hai; artifact store (volume) me models, plots jaisi files save hoti hain.

**Q4: `mlflow.set_tracking_uri("http://localhost:5000")` ki kya zaroorat hai?**
A: Iske baghair MLflow local `./mlruns` folder me log karta hai — tracking URI se saare runs central server par jate hain jahan team compare kar sakti hai.

## 🔜 Next Week

Final week! Week 16 me **batch jobs**, model ko **API ke peeche serve** karna, **replicas ke sath scaling** — aur poore 16-week safar ka wrap-up. 🎓
