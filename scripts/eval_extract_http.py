#!/usr/bin/env python3
# scripts/eval_extract_http.py
"""
Eval base vs ensemble on data/samples/eval_extract.jsonl by calling your Next.js API.
Run your app first: npm run dev
"""

import json, argparse, time, urllib.request

API_BASE = "http://127.0.0.1:3000"

def post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))

def jaccard(a, b):
    sa, sb = set(a or []), set(b or [])
    if not sa and not sb: return 1.0
    return len(sa & sb) / max(1, len(sa | sb))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default="data/samples/eval_extract.jsonl")
    args = ap.parse_args()

    base_valid = ens_valid = n = 0
    sev_match_base = sev_match_ens = 0
    needs_j_base = needs_j_ens = 0.0
    t_base = t_ens = 0.0

    with open(args.path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            item = json.loads(line)
            text = item["input"].strip()
            gold = item["gold"]["reports"][0]

            # base
            t0 = time.time()
            base = post_json(f"{API_BASE}/api/extract", {"text": text})
            t_base += (time.time() - t0)
            base_ok = isinstance(base, dict) and isinstance(base.get("reports"), list)
            base_valid += int(base_ok)
            if base_ok and base["reports"]:
                pred = base["reports"][0]
                sev_match_base += int(pred.get("severity") == gold.get("severity"))
                needs_j_base += jaccard(pred.get("needs"), gold.get("needs"))

            # ensemble
            t0 = time.time()
            ens = post_json(f"{API_BASE}/api/extract/ensemble", {"text": text, "samples": 3})
            t_ens += (time.time() - t0)
            ens_ok = isinstance(ens, dict) and isinstance(ens.get("reports"), list)
            ens_valid += int(ens_ok)
            if ens_ok and ens["reports"]:
                pred = ens["reports"][0]
                sev_match_ens += int(pred.get("severity") == gold.get("severity"))
                needs_j_ens += jaccard(pred.get("needs"), gold.get("needs"))

            n += 1

    print(f"Items: {n}")
    if n:
        print(f"Base   - JSON valid: {base_valid}/{n},  avg latency: {t_base*1000/n:.0f} ms, severity acc: {sev_match_base/n:.2f}, needs Jaccard: {needs_j_base/n:.2f}")
        print(f"Ens(3) - JSON valid: {ens_valid}/{n},  avg latency: {t_ens*1000/n:.0f} ms, severity acc: {sev_match_ens/n:.2f}, needs Jaccard: {needs_j_ens/n:.2f}")

if __name__ == "__main__":
    main()
