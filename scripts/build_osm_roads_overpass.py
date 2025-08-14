#!/usr/bin/env python
from __future__ import annotations
import argparse, json, sys, time
from typing import Dict, List, Tuple, Any
import requests

HIGHWAY_KEEP = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|"
    "secondary|secondary_link|tertiary|tertiary_link|unclassified|"
    "residential|living_street|service"
)

def fetch_overpass(west: float, south: float, east: float, north: float) -> Dict[str, Any]:
    # Overpass bbox order is: south,west,north,east (lat,lon,lat,lon)
    q = f"""
    [out:json][timeout:180];
    (
      way["highway"]["highway"~"^{HIGHWAY_KEEP}$"]
        ({south},{west},{north},{east});
    );
    (._;>;);
    out body;
    """
    url = "https://overpass-api.de/api/interpreter"
    r = requests.post(url, data={"data": q.strip()})
    r.raise_for_status()
    return r.json()

def to_geojson(data: Dict[str, Any]) -> Dict[str, Any]:
    nodes: Dict[int, Tuple[float, float]] = {}
    ways: List[Dict[str, Any]] = []
    for el in data.get("elements", []):
        if el.get("type") == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
    for el in data.get("elements", []):
        if el.get("type") == "way" and "nodes" in el:
            coords = []
            for nid in el["nodes"]:
                if nid in nodes:
                    coords.append(nodes[nid])
            if len(coords) >= 2:
                tags = el.get("tags", {})
                ways.append({
                    "type": "Feature",
                    "properties": {
                        "highway": tags.get("highway", ""),
                        "oneway": tags.get("oneway", ""),
                        "maxspeed": tags.get("maxspeed", "")
                    },
                    "geometry": {"type": "LineString", "coordinates": coords}
                })
    return {"type": "FeatureCollection", "features": ways}

def main():
    ap = argparse.ArgumentParser(description="Build drivable roads GeoJSON via Overpass (no OSMnx)")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("WEST","SOUTH","EAST","NORTH"),
                    required=True, help="Bounding box in lon/lat: W S E N")
    ap.add_argument("--out", required=True, help="Output GeoJSON path, e.g. data/roads.geojson")
    args = ap.parse_args()

    west, south, east, north = args.bbox
    data = fetch_overpass(west, south, east, north)
    fc = to_geojson(data)

    with open(args.out, "w") as f:
        json.dump(fc, f)
    print(f"Wrote {len(fc['features']):,} edges to {args.out}")

if __name__ == "__main__":
    sys.exit(main())
