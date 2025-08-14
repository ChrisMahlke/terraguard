#!/usr/bin/env python3
import json, argparse, math, os, random

def circle(center, r_m=600, steps=64):
    lng, lat = center
    dlat = r_m / 111320.0
    dlng = dlat / math.cos(math.radians(lat))
    coords = []
    for i in range(steps+1):
        a = (i/steps)*2*math.pi
        coords.append([lng + math.cos(a)*dlng, lat + math.sin(a)*dlat])
    return {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[coords]}}

def rect(center, w_m=900, h_m=600):
    lng, lat = center
    dlat = (h_m/111320.0)/2.0
    dlng = (w_m/111320.0)/(2.0*math.cos(math.radians(lat)))
    ring = [
        [lng-dlng, lat-dlat],[lng+dlng, lat-dlat],[lng+dlng, lat+dlat],
        [lng-dlng, lat+dlat],[lng-dlng, lat-dlat]
    ]
    return {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[ring]}}

def random_point_in_bbox(w,s,e,n):
    return [random.uniform(w,e), random.uniform(s,n)]

def main():
    ap = argparse.ArgumentParser(description="Create demo hazard GeoJSONs")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("WEST","SOUTH","EAST","NORTH"),
                    default=[-122.55, 37.70, -122.30, 37.85])
    ap.add_argument("--outdir", default="data/hazards")
    args = ap.parse_args()
    w,s,e,n = args.bbox
    os.makedirs(args.outdir, exist_ok=True)

    # Center-ish point
    c1 = [(w+e)/2.0, (s+n)/2.0]
    c2 = random_point_in_bbox(w,s,e,n)
    c3 = random_point_in_bbox(w,s,e,n)

    fc_fire = {"type":"FeatureCollection","features":[circle(c1, 700)]}
    fc_flood = {"type":"FeatureCollection","features":[rect(c2, 1200, 800)]}
    fc_multi = {"type":"FeatureCollection","features":[circle(c1, 500), rect(c3, 800, 500)]}

    with open(os.path.join(args.outdir, "sf_fire.geojson"), "w") as f:
        json.dump(fc_fire, f)
    with open(os.path.join(args.outdir, "sf_flood.geojson"), "w") as f:
        json.dump(fc_flood, f)
    with open(os.path.join(args.outdir, "sf_multi.geojson"), "w") as f:
        json.dump(fc_multi, f)

    print("Wrote:", ", ".join(["sf_fire.geojson","sf_flood.geojson","sf_multi.geojson"]), "to", args.outdir)

if __name__ == "__main__":
    main()
