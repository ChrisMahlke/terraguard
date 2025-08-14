# backend/train/make_sft.py
import os, json, random, math
from pathlib import Path

random.seed(7)

TEMPLATE_USER = {
    "prompt": "Agent plan for current extent",
    "context": {
        "bbox": None,                # [w,s,e,n]
        "start": None,               # [lng,lat]
        "end": None,                 # [lng,lat]
        "geojson": None              # (Multi)Polygon FC (combined hazards)
    }
}

def rand_pt(w, s, e, n):
    return [random.uniform(w, e), random.uniform(s, n)]

def circle(center, r_m=600, steps=48):
    lng, lat = center
    dlat = r_m / 111320.0
    dlng = dlat / math.cos(math.radians(lat))
    coords = []
    for i in range(steps+1):
        a = (i/steps)*2*math.pi
        coords.append([lng + math.cos(a)*dlng, lat + math.sin(a)*dlat])
    return coords

def make_example(bbox):
    w,s,e,n = bbox
    start = rand_pt(w,s,e,n)
    end = rand_pt(w,s,e,n)

    # build 0-2 circular hazard polygons
    polys = []
    for _ in range(random.choice([0,1,2])):
        c = rand_pt(w,s,e,n)
        polys.append([circle(c, r_m=random.choice([400,700,1000]))])

    geo = None
    if polys:
        geo = {"type":"FeatureCollection","features":[{
            "type":"Feature",
            "properties": {"name":"combined_hazards"},
            "geometry": {"type":"MultiPolygon","coordinates": polys}
        }]}

    user = json.dumps({
        "prompt": TEMPLATE_USER["prompt"],
        "context": {"bbox": bbox, "start": start, "end": end, "geojson": geo}
    }, separators=(",",":"))

    # Supervised target: what we WANT the model to emit (plan + tool-calls)
    # Keep it short and structured to match your backend expectations.
    target = {
      "plan": {
        "summary": "Compute safest route and communicate evac order.",
        "phases": [
          {"name": "Assess Hazard", "actions": [
            "Parse hazard geometry from context.geojson",
            "Mark no-go areas on the road network"
          ]},
          {"name": "Route", "actions": [
            "Call route_between with start/end and hazard",
            "If route blocked, compute alternates"
          ]},
          {"name": "Communicate", "actions": [
            "Share ETA and distance",
            "Note road closures near hazard perimeter"
          ]},
        ]
      },
      "calls": [
        {"tool":"route_between","args":{"start": start,"end": end,"purpose":"primary"}}
      ]
    }

    return {"messages": [
        {"role":"system","content":"You are a planning agent that may call tools. Return JSON with keys: plan{summary,phases[]}, calls[]. No text outside JSON."},
        {"role":"user","content": user},
        {"role":"assistant","content": json.dumps(target, separators=(",",":"))}
    ]}

def main():
    out_dir = Path("data/sft")
    out_dir.mkdir(parents=True, exist_ok=True)

    # SF bbox (same you’ve been using)
    bbox = [-122.55, 37.70, -122.30, 37.85]

    train, eval = [], []
    for i in range(400):
        ex = make_example(bbox)
        (train if i < 360 else eval).append(ex)

    with open(out_dir/"train.jsonl", "w") as f:
        for ex in train: f.write(json.dumps(ex)+"\n")
    with open(out_dir/"eval.jsonl", "w") as f:
        for ex in eval: f.write(json.dumps(ex)+"\n")

    print("Wrote", out_dir/"train.jsonl", "and", out_dir/"eval.jsonl")

if __name__ == "__main__":
    main()
