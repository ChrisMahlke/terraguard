#!/usr/bin/env python3
# scripts/merge_for_sft.py
"""
Merge real + synthetic into Chat-style SFT JSONL with strict prompts.
Writes: data/train_sft.jsonl
Each line: {"messages":[{"role":"system","content":...},{"role":"user","content":...},{"role":"assistant","content":...}]}
"""

import json, os, argparse, glob, sys
from datetime import datetime

EXTRACT_SYS = """You are an offline disaster-response triage assistant.

Return ONLY valid JSON that conforms to:

{ "reports": [ { "location_text": string|null, "time_iso": string|null,
"severity": "low"|"moderate"|"high"|"critical"|null, "needs": string[], "dedupe_key"?: string|null, "notes"?: string|null } ] }

Rules:
- JSON ONLY (no prose, no code fences).
- Never include latitude/longitude.
- If multiple reports are present, return multiple items.
- time_iso must be ISO-8601 if present, else null."""

def extract_user(inp: str) -> str:
    return f"TEXT:\n{inp}\n\nRespond ONLY with JSON for the schema."

ICS213_SYS = """You fill ICS-213 (General Message) using the provided incident snippet.
Return STRICT JSON with keys: to, from, subject, message, approved_by, date_time (ISO-8601).
No extra keys, no prose, no code fences. Do not invent names; use generic roles if unclear."""
def ics213_user(rep: dict) -> str:
    return "REPORT:\n" + json.dumps(rep, ensure_ascii=False, indent=2)

RADIO_SYS = """You create concise, plain-text radio transmissions in English and Spanish.
Return STRICT JSON: { "en": string, "es": string }
Rules:
- ≤ 18 words each
- Plain words; include location/time if present
- No extra fields, no code fences."""
def radio_user(rep: dict) -> str:
    return "REPORT:\n" + json.dumps(rep, ensure_ascii=False, indent=2)

def read_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line: continue
            yield json.loads(line)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/train_sft.jsonl")
    ap.add_argument("--synthetic_dir", default="data/synthetic")
    ap.add_argument("--real_dir", default="data/real")  # optional
    ap.add_argument("--mix", default="extract:2,ics213:1,radio:1", help="task ratios")
    args = ap.parse_args()

    paths = {
        "extract": glob.glob(os.path.join(args.synthetic_dir, "train_extract.jsonl")),
        "ics213": glob.glob(os.path.join(args.synthetic_dir, "train_ics213.jsonl")),
        "radio": glob.glob(os.path.join(args.synthetic_dir, "train_radio.jsonl")),
    }
    # If you have real data, you can drop similarly named files in data/real/
    for t in ["extract","ics213","radio"]:
        real = glob.glob(os.path.join(args.real_dir, f"train_{t}.jsonl"))
        if real: paths[t] += real

    pools = {t: [] for t in paths}
    for t, allfiles in paths.items():
        for p in allfiles:
            for ex in read_jsonl(p):
                pools[t].append(ex)

    if not any(len(pools[t]) for t in pools):
        print("No input data found. Run scripts/synthesize_data.py first.", file=sys.stderr)
        sys.exit(1)

    ratios = {}
    total_w = 0
    for part in args.mix.split(","):
        k, w = part.split(":")
        ratios[k] = int(w)
        total_w += int(w)

    # Build a round-robin mixture
    iters = {t: iter(pools[t]) for t in pools}
    # To keep it simple, just cycle through copies
    def next_item(t):
        # naive cycle
        iters[t] = iters.get(t) or iter(pools[t])
        try:
            return next(iters[t])
        except StopIteration:
            iters[t] = iter(pools[t])
            return next(iters[t])

    outpath = args.out
    os.makedirs(os.path.dirname(outpath), exist_ok=True)
    count = 0
    with open(outpath, "w", encoding="utf-8") as out:
        # cap length to something reasonable
        limit = min(50000, sum(len(v) for v in pools.values()))
        while count < limit:
            for t in ["extract","ics213","radio"]:
                w = ratios.get(t, 0)
                for _ in range(w):
                    ex = next_item(t)
                    if t == "extract":
                        msg = {
                            "messages":[
                                {"role":"system","content":EXTRACT_SYS},
                                {"role":"user","content":extract_user(ex["input"])},
                                {"role":"assistant","content":json.dumps(ex["gold"], ensure_ascii=False)}
                            ]
                        }
                    elif t == "ics213":
                        msg = {
                            "messages":[
                                {"role":"system","content":ICS213_SYS},
                                {"role":"user","content":ics213_user(ex["report"])},
                                {"role":"assistant","content":json.dumps({
                                    "to":"Operations","from":"Triage","subject":"General Message",
                                    "message": f"Incident at {ex['report']['location_text']} ({ex['report']['severity']}). Needs: {', '.join(ex['report']['needs'])}.",
                                    "approved_by": None,
                                    "date_time": ex["report"]["time_iso"] or datetime.now().astimezone().isoformat(timespec="minutes")
                                }, ensure_ascii=False)}
                            ]
                        }
                    else: # radio
                        # very small templated radios; the model will learn to paraphrase
                        loc = ex["report"]["location_text"] or "reported location"
                        sev = ex["report"]["severity"] or "unknown"
                        needs = ", ".join(ex["report"]["needs"] or [])
                        en = f"{sev} incident at {loc}. Needs: {needs}."
                        es = f"incidente {sev} en {loc}. Necesidades: {needs}."
                        msg = {
                            "messages":[
                                {"role":"system","content":RADIO_SYS},
                                {"role":"user","content":radio_user(ex["report"])},
                                {"role":"assistant","content":json.dumps({"en":en, "es":es}, ensure_ascii=False)}
                            ]
                        }
                    out.write(json.dumps(msg, ensure_ascii=False) + "\n")
                    count += 1
                    if count >= limit: break
                if count >= limit: break
            if count >= limit: break
    print(f"Wrote {outpath} with {count} examples.")

if __name__ == "__main__":
    main()
