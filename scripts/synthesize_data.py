#!/usr/bin/env python3
# scripts/synthesize_data.py
"""
Generate synthetic training triples for:
- extract (text -> strict JSON)
- ics213 (report -> strict ICS-213 JSON)
- radio (report -> {"en","es"} <= 18 words)

Outputs JSONL files in data/synthetic/.
Safe to run offline. No external deps beyond stdlib + tqdm (optional).
"""

import json, os, random, re, argparse, math
from datetime import datetime, timedelta, timezone
try:
    from tqdm import tqdm
except Exception:
    def tqdm(x, **k): return x  # fallback

NEEDS = {
    "medical":["med","ems","paramedic","first aid","clinic"],
    "rescue":["extrication","search","swiftwater","rope"],
    "fire":["engine","ladder","smoke","alarm"],
    "water":["bottled water","hydration"],
    "food":["meals","MRE","snacks"],
    "shelter":["blankets","cots","warming","cooling"],
    "logistics":["chainsaw","fuel","generator","traffic"],
}

SEVS = ["low","moderate","high","critical"]

LOC_TEMPL = [
    "Bridge on {street}",
    "{place} at {street}",
    "{street} & {cross}",
    "Behind {place}",
    "{num} {street} apt {apt}",
    "{place}",
]

PLACES = ["Lincoln Park","Community Hospital","Senior Center","Riverside School","Transit Hub","Warehouse D12"]
STREETS = ["Pine St","Maple Ave","Cedar St","Oak Ave","Birch Rd","Main St","1st Ave","5th St"]
CROSS = ["Main","1st","2nd","3rd","Broadway"]
APT = ["2A","3B","5C","7D"]
NUMS = ["1200","544","78","901","33","415"]

def rand_time_iso(prob=0.6):
    if random.random() > prob:
        return None
    base = datetime.now().astimezone()
    dt = base - timedelta(minutes=random.randint(0, 300))
    # round to 5-min bucket occasionally
    if random.random() < 0.5:
        dt = dt.replace(second=0, microsecond=0)
        m = (dt.minute // 5) * 5
        dt = dt.replace(minute=m)
    return dt.isoformat(timespec="minutes")

def make_location():
    t = random.choice(LOC_TEMPL)
    return (t
        .replace("{street}", random.choice(STREETS))
        .replace("{cross}", random.choice(CROSS))
        .replace("{place}", random.choice(PLACES))
        .replace("{num}", random.choice(NUMS))
        .replace("{apt}", random.choice(APT))
    )

def pick_needs(k=1):
    cats = random.sample(list(NEEDS.keys()), k=k)
    out = []
    for c in cats:
        if random.random() < 0.7:
            out.append(c)
        else:
            out.append(random.choice(NEEDS[c]))
    # normalize to base labels
    base = []
    for x in out:
        for root, vocab in NEEDS.items():
            if x == root or x in vocab:
                base.append(root)
                break
    # uniq
    return sorted(list({*base}))

def noisy_text(s: str):
    # light noise: lowercase chance, remove commas, slang
    if random.random() < 0.3:
        s = s.lower()
    if random.random() < 0.3:
        s = s.replace(",", "")
    if random.random() < 0.15:
        s = s.replace(" and ", " & ")
    if random.random() < 0.12:
        s = s.replace("apartment", "apt")
    return s

def to_spanish(s: str):
    repl = {
        "bridge":"puente","street":"calle","ave":"av","road":"carretera","park":"parque",
        "people":"personas","trapped":"atrapadas","need":"necesitan","medical":"médica",
        "rescue":"rescate","fire":"incendio","water":"agua","food":"comida","shelter":"albergue",
        "power":"electricidad","outage":"corte","evacuating":"evacuando"
    }
    out = s
    for en, es in repl.items():
        out = re.sub(rf"\b{en}\b", es, out, flags=re.IGNORECASE)
    return out

def make_extract_example():
    loc = make_location()
    time_iso = rand_time_iso()
    sev = random.choices(SEVS, weights=[2,3,3,2])[0]
    k = random.choice([1,1,1,2,2,3])
    needs = pick_needs(k)

    # build English text
    parts = []
    if "Bridge" in loc or "bridge" in loc.lower():
        parts.append(f"{loc} cracked")
    else:
        parts.append(f"At {loc}")
    if time_iso and random.random() < 0.7:
        local = datetime.fromisoformat(time_iso)
        parts.append(f"~{local.strftime('%-I:%M%p').lower()}")
    if "medical" in needs and "rescue" in needs:
        parts.append("people trapped, need medical & rescue")
    elif needs:
        parts.append("need " + ", ".join(needs))
    else:
        parts.append("monitor")
    if sev in ["high","critical"] and random.random() < 0.4:
        parts.append("urgent")

    eng = noisy_text("; ".join(parts)) + "."
    if random.random() < 0.2:
        eng = to_spanish(eng)

    gold = {
        "reports":[{
            "location_text": loc,
            "time_iso": time_iso,
            "severity": sev,
            "needs": needs,
            "notes": None
        }]
    }
    return {"task":"extract","input":eng,"gold":gold}

def make_ics213_example():
    ex = make_extract_example()
    r = ex["gold"]["reports"][0]
    rep = {
        "id": "synth",
        "location_text": r["location_text"],
        "time_iso": r["time_iso"],
        "severity": r["severity"],
        "needs": r["needs"],
        "notes": r.get("notes")
    }
    return {"task":"ics213","report":rep}

def make_radio_example():
    ex = make_extract_example()
    r = ex["gold"]["reports"][0]
    rep = {
        "id": "synth",
        "location_text": r["location_text"],
        "time_iso": r["time_iso"],
        "severity": r["severity"],
        "needs": r["needs"],
        "notes": r.get("notes")
    }
    return {"task":"radio","report":rep}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n_extract", type=int, default=300)
    ap.add_argument("--n_ics213", type=int, default=150)
    ap.add_argument("--n_radio", type=int, default=150)
    ap.add_argument("--outdir", type=str, default="data/synthetic")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = {
        "extract": os.path.join(args.outdir, "train_extract.jsonl"),
        "ics213": os.path.join(args.outdir, "train_ics213.jsonl"),
        "radio": os.path.join(args.outdir, "train_radio.jsonl"),
    }
    fp = {k: open(v, "w", encoding="utf-8") for k,v in files.items()}

    for _ in tqdm(range(args.n_extract), desc="extract"):
        json.dump(make_extract_example(), fp["extract"]); fp["extract"].write("\n")

    for _ in tqdm(range(args.n_ics213), desc="ics213"):
        json.dump(make_ics213_example(), fp["ics213"]); fp["ics213"].write("\n")

    for _ in tqdm(range(args.n_radio), desc="radio"):
        json.dump(make_radio_example(), fp["radio"]); fp["radio"].write("\n")

    for f in fp.values(): f.close()
    print("Wrote:", files)

if __name__ == "__main__":
    main()
