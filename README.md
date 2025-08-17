# Terraguard

**Terraguard** is an offline-first disaster response triage tool. It runs locally, turns messy incident text (SMS, radio, social) into **strict JSON**, **ICS forms**, and **concise radio phrasing**, and can swap in a **LoRA-fine-tuned model** that improves extraction on NFIRS-style fire incidents.

- Usable without internet (everything can run on your laptop or a single GCP VM).
- Includes a full recipe to fine-tune a small model on cause codes and wire it into the app.
- Schema-only outputs, clear abstentions, no hallucinated coordinates.

---

## Table of contents

- [Terraguard](#terraguard)
  - [Table of contents](#table-of-contents)
  - [What Terraguard does](#what-terraguard-does)
  - [Architecture](#architecture)
  - [Quickstart (local UI, 5–10 min)](#quickstart-local-ui-510-min)
  - [Data: importing the 1 GB `causes.txt`](#data-importing-the-1-gb-causestxt)
  - [Make a tiny sample to sanity-check](#make-a-tiny-sample-to-sanity-check)
  - [Optional: build label maps \& priors](#optional-build-label-maps--priors)
  - [Fine-tune (GCP, LoRA/QLoRA)](#fine-tune-gcp-loraqlora)
    - [1) GCP project \& auth (once)](#1-gcp-project--auth-once)
    - [2) Bucket for artifacts](#2-bucket-for-artifacts)
    - [3) Create a GPU VM (PyTorch DLVM image)](#3-create-a-gpu-vm-pytorch-dlvm-image)
    - [4) Python env \& deps on the VM](#4-python-env--deps-on-the-vm)
    - [5) Get your data to the VM](#5-get-your-data-to-the-vm)
    - [6) Hugging Face auth (for model weights)](#6-hugging-face-auth-for-model-weights)
    - [7) Create SFT files \& train](#7-create-sft-files--train)
  - [Serve your fine-tune and plug into the UI](#serve-your-fine-tune-and-plug-into-the-ui)
    - [1) Start the tiny API server **on the VM**](#1-start-the-tiny-api-server-on-the-vm)
    - [2) Tunnel port 8000 to your laptop](#2-tunnel-port-8000-to-your-laptop)
    - [3) Point the UI at your fine-tune](#3-point-the-ui-at-your-fine-tune)
  - [Evaluate accuracy \& latency](#evaluate-accuracy--latency)
  - [Operate safely \& keep costs down](#operate-safely--keep-costs-down)
  - [FAQ / Troubleshooting](#faq--troubleshooting)
    - [DuckDB “FDID INTEGER” error](#duckdb-fdid-integer-error)
    - [HF 401 / RepositoryNotFound](#hf-401--repositorynotfound)
    - [Transformers/tokenizers version mismatch](#transformerstokenizers-version-mismatch)
    - [CUDA OOM on 20B](#cuda-oom-on-20b)
    - [Server responds with your prompt (echo)](#server-responds-with-your-prompt-echo)
    - [Tunnel shows no output](#tunnel-shows-no-output)
    - [“/health Not Found”](#health-not-found)
    - [`element 0 of tensors does not require grad`](#element-0-of-tensors-does-not-require-grad)
    - [Priors JSON “extra data”](#priors-json-extra-data)
  - [Why this is useful](#why-this-is-useful)
  - [License](#license)

---

## What Terraguard does

Paste an incident like:

```txt
Bridge on Pine St is cracked, 2:15pm, 5 people trapped on the south side, need medical and rescue.
```

Click **Extract** and Terraguard returns **strict JSON** under our schema, then helps you generate **ICS-213 / ICS-214** objects and short **radio phrasing (EN/ES)**. For fire incidents with NFIRS-style fields, you can switch the model to a **fine-tune** that predicts the **General Cause Code (GCC)** and **Cause Code** with higher fidelity.

---

## Architecture

```txt
terraguard/
├─ src/app/                   # Next.js App Router + API routes
│  ├─ api/                    # /api/extract*, /api/causes, etc.
│  ├─ page.tsx                # Home (ReportTriage)
│  ├─ eval/page.tsx           # /eval — batch JSON-valid & latency
│  └─ ...                     # MUI/Redux wiring
├─ scripts/                   # Data & training utilities (Python)
│  ├─ verify_causes_sample.py
│  ├─ prepare_labels.py
│  ├─ build_pcc_priors.py
│  ├─ augment_from_pcc_priors.py
│  ├─ eval_causes_http.py
│  ├─ train_terraguard_qlora_7b.py
│  ├─ train_continue_pcc.py
│  └─ serve_ft.py
├─ data/
│  ├─ raw/                    # Put causes_2024.txt here (1 GB, ^ delimited)
│  ├─ processed/              # Parquet + derived CSVs
│  ├─ samples/                # 1k demo slices
│  └─ sft/                    # SFT train/val JSONL
└─ README.md
```

- **Frontend**: Next.js 15 + React + MUI (accessible, mobile-friendly).
- **Backend (local)**: Next.js API routes call a local model endpoint.
- **Models**:

  - **Base/Ensemble**: any local model endpoint (Ollama or compatible).
  - **Fine**: a small **Qwen2.5-7B-Instruct LoRA** we train with QLoRA.

- **Strict outputs**: Everything pipes through a validator; UI shows **valid/invalid** and errors.

---

## Quickstart (local UI, 5–10 min)

**Prereqs (macOS):**

- Node.js **>= 20**
- Python **>= 3.10**
- (Optional for data steps) DuckDB: `brew install duckdb`

1. Install and run the app

```bash
# from project root
npm install

# configure local endpoints (create .env.local)
cat > .env.local <<'ENV'
# If you run a local fine-tune server later, set this to http://127.0.0.1:8000
NEXT_PUBLIC_FT_BASE=http://127.0.0.1:8000
ENV

npm run dev
# open http://localhost:3000
```

2. Try the UI

- Paste any short incident sentence, click **Extract**.
- Open **Compare** to run Base vs Ensemble vs (later) Fine.
- Open **/eval** for a mini batch validator & latency chart.

> You can connect the Fine model later; the UI runs without it.

---

## Data: importing the 1 GB `causes.txt`

The public NFIRS-style file is caret-delimited (`^`), with quoted fields and a header row.

**Put the file here:**

```txt
data/raw/causes_2024.txt
```

**Convert to Parquet with DuckDB (fast & typed):**

> We explicitly set types to avoid the “FDID INTEGER” error you might see.

```bash
duckdb -c "
COPY (
  SELECT
    INCIDENT_KEY::VARCHAR,
    STATE::VARCHAR,
    FDID::VARCHAR,                -- keep as text; some are alphanumeric
    INC_DATE::INTEGER,
    INC_NO::VARCHAR,
    EXP_NO::INTEGER,
    PCC::INTEGER,
    CAUSE_CODE::VARCHAR,          -- two-digit code as text
    GCC::VARCHAR                  -- two-digit code as text
  FROM read_csv(
    'data/raw/causes_2024.txt',
    delim='^', header=true, quote='\"', types=auto
  )
) TO 'data/processed/causes_2024.parquet' (FORMAT PARQUET);
"
```

**Sanity checks:**

```bash
# counts by GCC
duckdb -c "
SELECT GCC, COUNT(*) AS n
FROM read_parquet('data/processed/causes_2024.parquet')
GROUP BY 1 ORDER BY n DESC LIMIT 10;
"

# decode to names (built-in map in the SQL below)
duckdb -c "
WITH m_gcc(GCC, GCC_NAME) AS (
  VALUES ('01','Firesetting'),('02','Natural'),('03','Equipment'),
         ('04','Electrical'),('05','Flame/Heat'),('06','Exposure'),('07','Unknown')
),
m_cause(CAUSE_CODE, CAUSE_NAME) AS (
  VALUES ('01','Intentional'),('02','Playing with Heat Source'),('03','Smoking'),
         ('04','Heating'),('05','Cooking'),('06','Electrical Malfunction'),
         ('07','Appliances'),('08','Open Flame'),('09','Other Heat'),
         ('10','Other Equipment'),('11','Natural'),('12','Exposure'),
         ('13','Unknown'),('14','Equipment Misoperation/Failure'),
         ('15','Other Unintentional/Careless'),('16','Cause Under Investigation')
)
SELECT c.GCC, g.GCC_NAME, COUNT(*) n
FROM read_parquet('data/processed/causes_2024.parquet') c
LEFT JOIN m_gcc g USING (GCC)
GROUP BY 1,2 ORDER BY n DESC;
"
```

---

## Make a tiny sample to sanity-check

Create a 1k CSV sample with decoded labels for quick inspection:

```bash
duckdb -c "
COPY (
  SELECT
    INCIDENT_KEY, STATE, FDID, CAST(INC_DATE AS VARCHAR) AS inc_date,
    INC_NO, EXP_NO, PCC,
    CAUSE_CODE,  -- e.g. '05'
    CASE CAUSE_CODE
      WHEN '01' THEN 'Intentional' WHEN '02' THEN 'Playing with Heat Source'
      WHEN '03' THEN 'Smoking'     WHEN '04' THEN 'Heating'
      WHEN '05' THEN 'Cooking'     WHEN '06' THEN 'Electrical Malfunction'
      WHEN '07' THEN 'Appliances'  WHEN '08' THEN 'Open Flame'
      WHEN '09' THEN 'Other Heat'  WHEN '10' THEN 'Other Equipment'
      WHEN '11' THEN 'Natural'     WHEN '12' THEN 'Exposure'
      WHEN '13' THEN 'Unknown'     WHEN '14' THEN 'Equipment Misoperation/Failure'
      WHEN '15' THEN 'Other Unintentional/Careless' WHEN '16' THEN 'Cause Under Investigation'
    END AS CAUSE_NAME,
    GCC,      -- e.g. '03'
    CASE GCC
      WHEN '01' THEN 'Firesetting' WHEN '02' THEN 'Natural' WHEN '03' THEN 'Equipment'
      WHEN '04' THEN 'Electrical'  WHEN '05' THEN 'Flame/Heat' WHEN '06' THEN 'Exposure'
      WHEN '07' THEN 'Unknown'
    END AS GCC_NAME
  FROM read_parquet('data/processed/causes_2024.parquet')
  ORDER BY random() LIMIT 1000
) TO 'data/samples/causes_decoded_1k.csv' WITH (HEADER, DELIMITER ',');
"
```

Verify with Polars:

```bash
python scripts/verify_causes_sample.py
```

You should see a 2024 date range and top groups like **GCC=03 Equipment**, **GCC=07 Unknown**, etc.

---

## Optional: build label maps & priors

These help with evaluation and simple fallbacks.

```bash
# top counts per label -> csv + json maps
python scripts/prepare_labels.py

# (optional) build P(Cause | PCC) priors from the big parquet
python scripts/build_pcc_priors.py

# (optional) synthesize a small SFT augment set from priors
python scripts/augment_from_pcc_priors.py
# writes data/sft/augment_pcc.jsonl
```

---

## Fine-tune (GCP, LoRA/QLoRA)

We fine-tune **Qwen2.5-7B-Instruct** with QLoRA on a single **NVIDIA L4 (g2-standard-8)**.

> You can also do this on a larger local GPU; we document GCP because it’s simple and reproducible.

### 1) GCP project & auth (once)

```bash
gcloud init                  # select your project (e.g., terragaurd)
gcloud auth login
gcloud config set project terragaurd
gcloud config set compute/zone us-central1-a
gcloud config set compute/region us-central1
```

If you see GPU quota errors, request **GPUS_ALL_REGIONS: 1** in the Quotas page.

### 2) Bucket for artifacts

```bash
BUCKET=gs://terragaurd-data-<yourid>
gcloud storage buckets create "$BUCKET" --location=us-central1
gcloud storage cp data/processed/causes_2024_decoded.parquet "$BUCKET"/
```

### 3) Create a GPU VM (PyTorch DLVM image)

```bash
IMAGE=$(gcloud compute images describe-from-family \
  pytorch-2-7-cu128-ubuntu-2204-nvidia-570 \
  --project deeplearning-platform-release \
  --format="value(name)")

gcloud compute instances create terraguard-train-1 \
  --zone=us-central1-a \
  --machine-type=g2-standard-8 \
  --image="$IMAGE" \
  --image-project=deeplearning-platform-release \
  --boot-disk-size=200GB \
  --maintenance-policy=TERMINATE \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

SSH in:

```bash
gcloud compute ssh terraguard-train-1 --zone us-central1-a
```

### 4) Python env & deps on the VM

```bash
# create venv
python3 -m venv ~/tg-venv
source ~/tg-venv/bin/activate
python -m pip install --upgrade pip

# libs
pip install "transformers==4.55.2" "datasets" "peft>=0.17.0" \
            "accelerate>=1.0.0" "trl==0.21.0" bitsandbytes hf_transfer

# sanity
python - <<'PY'
import torch, transformers, peft, accelerate, bitsandbytes
print("Torch:", torch.__version__)
print("CUDA:", torch.cuda.is_available(), torch.cuda.get_device_name(0))
print("Transformers:", transformers.__version__)
print("PEFT:", peft.__version__)
print("Accelerate:", accelerate.__version__)
print("bitsandbytes:", getattr(bitsandbytes,"__version__","?"))
PY
```

### 5) Get your data to the VM

```bash
gcloud storage cp "$BUCKET"/causes_2024_decoded.parquet ~/
```

### 6) Hugging Face auth (for model weights)

```bash
hf auth login    # paste your HF token (read)
```

### 7) Create SFT files & train

The training scripts live in `~/` on the VM (you can also copy them from `scripts/`). They:

- build **`data/sft/train.jsonl`** and **`val.jsonl`** with chat messages:

  - **system**: “Return JSON with GCC/GCC_NAME/CAUSE_CODE/CAUSE_NAME…”
  - **user**: one incident (STATE, FDID, INC_DATE, INC_NO, EXP_NO, PCC)
  - **assistant**: gold JSON from your parquet

- run **QLoRA** with 4-bit base weights and small LoRA ranks

```bash
python ~/train_terraguard_qlora_7b.py
# outputs LoRA adapter at ~/terraguard-ft-qwen2p5-7b
```

(Optionally continue with PCC-augmented data:)

```bash
# first copy augment_pcc.jsonl from your laptop if you created it:
# gcloud compute scp --zone us-central1-a data/sft/augment_pcc.jsonl terraguard-train-1:~/data/sft/
python ~/train_continue_pcc.py
# updates the same adapter dir
```

---

## Serve your fine-tune and plug into the UI

### 1) Start the tiny API server **on the VM**

```bash
source ~/tg-venv/bin/activate
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
python ~/serve_ft.py
# outputs: "Uvicorn running on http://127.0.0.1:8000"
```

### 2) Tunnel port 8000 to your laptop

On your laptop (new terminal):

```bash
gcloud compute ssh terraguard-train-1 --zone us-central1-a -- -N -L 8000:127.0.0.1:8000
# keep this window open (Ctrl+C to close tunnel)
```

### 3) Point the UI at your fine-tune

In the project root on your laptop:

```bash
# ensure FT base is set
grep NEXT_PUBLIC_FT_BASE .env.local || echo NEXT_PUBLIC_FT_BASE=http://127.0.0.1:8000 >> .env.local

npm run dev
# open http://localhost:3000
```

- In the navbar, set **Model → Fine**.
- Paste a **NFIRS-style incident** and click **Extract**.

**Copy/paste incident you can use:**

```txt
Incident record:
STATE=MA
FDID=09298
INC_DATE=2024-09-20
INC_NO=1252
EXP_NO=0
PCC=12

Return JSON only.
```

Expected shape:

```json
{
  "GCC": "03",
  "GCC_NAME": "Equipment",
  "CAUSE_CODE": "05",
  "CAUSE_NAME": "Cooking"
}
```

---

## Evaluate accuracy & latency

From your laptop (UI running):

```bash
python scripts/eval_causes_http.py --n 100 --base http://localhost:3000
```

You’ll see:

- **Accuracy GCC** (exact match on the two-digit code)
- **Accuracy CAUSE**
- **Exact (both codes match)**
- **Avg latency (s)** per call

This gives a quick read on whether your fine-tune outperforms the base/ensemble on held-out samples. You can bump `--n` for more stable numbers.

---

## Operate safely & keep costs down

**Pause costs when idle**:

```bash
# stop GPU VM
gcloud compute instances stop terraguard-train-1 --zone us-central1-a
# resume later
gcloud compute instances start terraguard-train-1 --zone us-central1-a
```

When you’re finished:

```bash
# (optional) save the adapter to GCS
tar -C ~ -czf ~/terraguard-ft-qwen2p5-7b.tar.gz terraguard-ft-qwen2p5-7b
gcloud storage cp ~/terraguard-ft-qwen2p5-7b.tar.gz "$BUCKET"/ft/

# delete the VM (keeps your bucket)
gcloud compute instances delete terraguard-train-1 --zone us-central1-a
```

---

## FAQ / Troubleshooting

### DuckDB “FDID INTEGER” error

- Ensure **FDID** is cast to `VARCHAR` in the DuckDB `COPY` query above.

### HF 401 / RepositoryNotFound

- Run `hf auth login` and paste a valid token (Settings → Access Tokens on HF).

### Transformers/tokenizers version mismatch

- We tested with: `transformers==4.55.2`, `trl==0.21.0`, `peft>=0.17.0`, `accelerate>=1.0.0`, `bitsandbytes==0.47.0`.

### CUDA OOM on 20B

- Use **Qwen2.5-7B-Instruct** for this recipe on an **L4**. 20B models won’t fit comfortably on a single L4 for fine-tuning/inference without heavier quantization/offload tricks.

### Server responds with your prompt (echo)

- You likely hit the **wrong route**. Use the wrapper:

  ```bash
  curl -s http://127.0.0.1:8000/api/generate -H 'Content-Type: application/json' \
    -d '{"prompt":"...","max_new_tokens":64}'
  ```

- In the UI `.env.local`, ensure `NEXT_PUBLIC_FT_BASE=http://127.0.0.1:8000`.

### Tunnel shows no output

- That’s normal for `-N -L`. Keep the window open. If closed, the UI can’t reach the VM.

### “/health Not Found”

- The sample server exposes `/api/generate`. Use that route.

### `element 0 of tensors does not require grad`

- If you continue training, ensure you load the adapter and **re-enable adapters** (our `train_continue_pcc.py` does this for you).

### Priors JSON “extra data”

- You may have accidentally written multiple JSON objects into one file. Our script writes **JSONL** (one object per line).

---

## Why this is useful

- **Offline-first**: works in austere environments (incidents, field ops, exercises).
- **Strict structures**: schemas keep UIs simple and reduce hallucinations.
- **LoRA swap-in**: domain-adapt quickly with small adapters; keep a safe base model.
- **Explainable UX**: Compare dialog shows concrete differences and timings.

---

## License

See [LICENSE](./LICENSE). If you fine-tune additional weights or add datasets, include a note about the source and license.
