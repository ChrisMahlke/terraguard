import argparse, json, time, requests, pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--csv", default="data/samples/causes_decoded_1k.csv")
ap.add_argument("--n", type=int, default=100)
ap.add_argument("--base", default="http://localhost:3000")
args = ap.parse_args()

# Read as strings so we can zero-pad consistently
df = pd.read_csv(args.csv, dtype={"GCC": str, "CAUSE_CODE": str})
df["GCC"] = df["GCC"].str.strip().str.zfill(2)
df["CAUSE_CODE"] = df["CAUSE_CODE"].str.strip().str.zfill(2)
df["GCC_NAME"] = df["GCC_NAME"].astype(str).str.strip()
df["CAUSE_NAME"] = df["CAUSE_NAME"].astype(str).str.strip()
df = df.head(args.n).copy()

def make_text(r):
    return f"""STATE={r.STATE}
FDID={r.FDID}
INC_DATE={r.inc_date}
INC_NO={r.INC_NO}
EXP_NO={r.EXP_NO}
PCC={r.PCC}"""

preds = []
bad = []
for i, r in df.iterrows():
    body = {"text": make_text(r)}
    t0 = time.time()
    try:
        res = requests.post(f"{args.base}/api/causes", json=body, timeout=60)
        res.raise_for_status()
        data = res.json()
        out = data.get("result", {}) or {}
        latency = time.time() - t0
        # normalize predicted codes too
        gcc = str(out.get("GCC","")).strip().zfill(2)
        cause = str(out.get("CAUSE_CODE","")).strip().zfill(2)
        preds.append({
            "GCC": gcc, "CAUSE_CODE": cause,
            "GCC_NAME": str(out.get("GCC_NAME","")).strip(),
            "CAUSE_NAME": str(out.get("CAUSE_NAME","")).strip(),
            "latency_s": round(latency,3)
        })
    except Exception as e:
        preds.append({"GCC":"", "CAUSE_CODE":"", "GCC_NAME":"", "CAUSE_NAME":"", "latency_s": None})
        bad.append((i, str(e)))

pred = pd.DataFrame(preds)
gold = df[["GCC","CAUSE_CODE","GCC_NAME","CAUSE_NAME"]].reset_index(drop=True)

acc_gcc   = (pred["GCC"]       == gold["GCC"]).mean()
acc_cause = (pred["CAUSE_CODE"]== gold["CAUSE_CODE"]).mean()
acc_exact = ((pred["GCC"]==gold["GCC"]) & (pred["CAUSE_CODE"]==gold["CAUSE_CODE"])).mean()
lat_mean  = pred["latency_s"].dropna().mean()

print(f"Samples: {len(pred)}   Failures: {len(bad)}")
print(f"Accuracy GCC:   {acc_gcc:.3f}")
print(f"Accuracy CAUSE: {acc_cause:.3f}")
print(f"Exact (both codes match): {acc_exact:.3f}")
print(f"Avg latency (s): {lat_mean:.3f}")

# show a few mismatches
mm = pd.concat([gold.add_prefix("gold_"), pred.add_prefix("pred_")], axis=1)
mm = mm[(mm["gold_GCC"]!=mm["pred_GCC"]) | (mm["gold_CAUSE_CODE"]!=mm["pred_CAUSE_CODE"])]
print("\nExamples of mismatches (up to 5):")
print(mm.head(5).to_string(index=False))
