# scripts/build_overpass_roads.py
import argparse, json, sys, time
from typing import Dict, List, Tuple, Any
import requests

ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

DRIVABLE = {
    "motorway","trunk","primary","secondary","tertiary",
    "unclassified","residential","service","living_street",
    "motorway_link","trunk_link","primary_link","secondary_link","tertiary_link"
}

def build_query(south: float, west: float, north: float, east: float, drivable_only: bool) -> str:
    # Overpass needs bbox in order: south,west,north,east
    if drivable_only:
        klass = "|".join(sorted(DRIVABLE))
        filt = f'["highway"~"^({klass})$"]'
    else:
        filt = '["highway"]'
    return f"""
[out:json][timeout:180];
way{filt}({south},{west},{north},{east});
(._;>;);   // fetch referenced nodes
out body;
"""

def fetch_overpass(query: str) -> Dict[str, Any]:
    last_err = None
    for url in ENDPOINTS:
        try:
            r = requests.post(url, data={"data": query}, timeout=180)
            if r.status_code == 429:
                time.sleep(5);  # brief backoff and retry this endpoint once
                r = requests.post(url, data={"data": query}, timeout=180)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            continue
    raise SystemExit(f"Overpass query failed on all endpoints: {last_err}")

def to_geojson(overpass_json: Dict[str, Any]) -> Dict[str, Any]:
    els = overpass_json.get("elements", [])
    nodes: Dict[int, Tuple[float,float]] = {}
    features: List[Dict[str, Any]] = []
    # Map node id -> (lon,lat)
    for el in els:
        if el.get("type") == "node":
            nodes[el["id"]] = (float(el["lon"]), float(el["lat"]))
    # Convert ways to LineString features
    for el in els:
        if el.get("type") != "way": continue
        nds = el.get("nodes", [])
        coords = []
        for nid in nds:
            pt = nodes.get(nid)
            if pt: coords.append(pt)
        if len(coords) < 2:
            continue
        props = el.get("tags", {}).copy() if el.get("tags") else {}
        props["osmid"] = el.get("id")
        feat = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "LineString", "coordinates": coords}
        }
        features.append(feat)
    return {"type": "FeatureCollection", "features": features}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("minx","miny","maxx","maxy"), required=True)
    ap.add_argument("--out", type=str, default="data/roads.geojson")
    ap.add_argument("--drivable-only", action="store_true")
    args = ap.parse_args()

    minx, miny, maxx, maxy = args.bbox
    query = build_query(south=miny, west=minx, north=maxy, east=maxx, drivable_only=args.drivable_only)
    data = fetch_overpass(query)
    fc = to_geojson(data)

    # Write file
    import os
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(fc, f)
    print(f"Wrote {args.out} with {len(fc['features'])} features")

if __name__ == "__main__":
    main()
