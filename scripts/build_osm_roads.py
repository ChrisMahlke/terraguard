# scripts/build_osm_roads.py
import argparse, os
import osmnx as ox
import geopandas as gpd

ox.settings.use_cache = True
ox.settings.log_console = True

def features_from_bbox_compat(north, south, east, west, tags):
    """
    OSMnx v2.x: features_from_bbox(north, south, east, west, tags=...)
    (Some releases also accept bbox=(n,s,e,w), but we try positional first.)
    """
    # v2.x positional first
    try:
        return ox.features.features_from_bbox(north, south, east, west, tags=tags)
    except TypeError:
        # some builds prefer bbox kwarg
        return ox.features.features_from_bbox(bbox=(north, south, east, west), tags=tags)

parser = argparse.ArgumentParser()
parser.add_argument("--bbox", nargs=4, type=float, metavar=("minx","miny","maxx","maxy"),
                    required=True, help="WGS84 bbox")
parser.add_argument("--out", type=str, default="data/roads.geojson")
# optional: narrow to drivable road classes (keeps file small & clean)
parser.add_argument("--drivable-only", action="store_true", help="Filter to common drivable road classes")
args = parser.parse_args()

minx, miny, maxx, maxy = args.bbox
north, south, east, west = maxy, miny, maxx, minx

# Request all OSM 'highway' features in bbox
tags = {"highway": True}
gdf = features_from_bbox_compat(north, south, east, west, tags)

# Keep only lines for routing
gdf = gdf[gdf.geometry.notnull()]
gdf = gdf[gdf.geometry.geom_type.isin(["LineString", "MultiLineString"])]

if args.drivable_only and "highway" in gdf.columns:
    allowed = {
        "motorway","trunk","primary","secondary","tertiary",
        "unclassified","residential","service","living_street","motorway_link",
        "trunk_link","primary_link","secondary_link","tertiary_link"
    }
    gdf = gdf[gdf["highway"].isin(list(allowed))]

# Ensure WGS84
try:
    gdf = gdf.to_crs(4326)
except Exception:
    pass

# Explode multilines so each row is a simple LineString
gdf = gdf.explode(index_parts=False, ignore_index=True)

os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
gdf.to_file(args.out, driver="GeoJSON")
print(f"Wrote {args.out} with {len(gdf)} features")
