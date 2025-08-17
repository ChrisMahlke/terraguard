import os, json, random, datetime as dt

PRIORS = "data/priors/pcc_top.json"   # DuckDB wrote NDJSON (one JSON per line)
OUT    = "data/sft/augment_pcc.jsonl"
os.makedirs("data/sft", exist_ok=True)

def load_json_or_ndjson(path: str):
    with open(path, "r") as f:
        txt = f.read().strip()
    if not txt:
        return []
    # Try as a single JSON (array/object) first
    try:
        obj = json.loads(txt)
        return obj if isinstance(obj, list) else [obj]
    except json.JSONDecodeError:
        pass
    # Fallback: NDJSON (one JSON per line)
    out = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out

US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"]

def rand_date_2024():
    start = dt.date(2024,1,1)
    end   = dt.date(2024,12,31)
    d = start + dt.timedelta(days=random.randint(0,(end-start).days))
    return d.isoformat()

def rand_fdid():
    return f"{random.choice('0123456789')}{random.choice('0123456789')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('0123456789')}{random.choice('0123456789')}"

def make_example(pcc:int, lab:dict):
    state = random.choice(US_STATES)
    fdid  = rand_fdid()
    inc_no = f"{random.randint(0,9999999):07d}"
    inc_date = rand_date_2024()
    user_text = (f"Incident record:\n"
                 f"STATE={state}\nFDID={fdid}\nINC_DATE={inc_date}\n"
                 f"INC_NO={inc_no}\nEXP_NO=0\nPCC={pcc}\n\nReturn JSON only.")
    out = {
        "GCC": lab["GCC"],
        "GCC_NAME": lab["GCC_NAME"],
        "CAUSE_CODE": lab["CAUSE_CODE"],
        "CAUSE_NAME": lab["CAUSE_NAME"],
    }
    return {
        "messages": [
            {
              "role": "system",
              "content": "You are Terraguard. Given one NFIRS-style incident record, return ONLY compact JSON with keys: GCC, GCC_NAME, CAUSE_CODE, CAUSE_NAME. Do not invent fields or prose."
            },
            { "role": "user", "content": user_text },
            { "role": "assistant", "content": json.dumps(out, ensure_ascii=False) }
        ]
    }

# Load priors (NDJSON)
priors_arr = load_json_or_ndjson(PRIORS)

# Sort by count desc (n may be str/int)
def _count(r): 
    try: return int(r.get("n", 0))
    except: return 0

priors_arr.sort(key=_count, reverse=True)

# Keep top ~30 PCCs by frequency
TOP = priors_arr[:30]

random.seed(13)
examples = []
for r in TOP:
    try:
        pcc = int(r["PCC"])
    except:
        continue
    label = {
        "GCC": str(r["GCC"]).zfill(2),
        "GCC_NAME": str(r["GCC_NAME"]),
        "CAUSE_CODE": str(r["CAUSE_CODE"]).zfill(2),
        "CAUSE_NAME": str(r["CAUSE_NAME"]),
    }
    for _ in range(10):  # 10 examples per PCC
        examples.append(make_example(pcc, label))

with open(OUT, "w") as f:
    for ex in examples:
        f.write(json.dumps(ex, ensure_ascii=False) + "\n")

print(f"Wrote {OUT} with {len(examples)} examples across {len(TOP)} PCCs")
with open(OUT, "r") as f:
    for i in range(2):
        print(f.readline().strip())
