#!/usr/bin/env python
from __future__ import annotations
import argparse, json, sys
from typing import Tuple

import osmnx as ox
import geopandas as gpd
from shapely.geometry import mapping

ox.settings.use_cache = True
ox.settings.log_console = False

def graph_from_bbox_compat(north: float, south: float, east: float, west: float, network_type="drive"):
    """
    OSMnx v2+ expects bbox=(N,S,E,W). Older code passed 4 args.
    Try the new signature first, then fall back.
    """
    try:
        return ox.graph.graph_from_bbox(bbox=(north, south, east, west), network_type=network_type)
    except TypeError:
        return ox.graph.graph_from_bbox(north, south, east, west, network_type=network_type)

def graph_from_place_compat(place: str, network_type="drive"):
    try:
        return ox.graph.graph_from_place(place, network_type=network_type)
    except Exception:
        # robust fallback: geocode polygon then use graph_from_polygon
        gdf = ox.geocode_to_gdf(place)
        poly = gdf.unary_union
        return ox.graph.graph_from_polygon(poly, network_type=network_type)

def _first(v):
    if isinstance(v, (list, tuple)) and v:
        return v[0]
    return v

def _norm_oneway(v):
    # Router expects strings like "yes" or "-1" (reverse). Normalize bools/ints/strings.
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("yes", "true", "1", "-1", "reverse"): return s
        return ""
    if v in (True, 1): return "yes"
    if v in (-1,): return "-1"
    return ""

def main():
    ap = argparse.ArgumentParser(description="Build drivable roads GeoJSON from OSM for TerraGuard")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--bbox", nargs=4, type=float, metavar=("WEST","SOUTH","EAST","NORTH"),
                     help="Bounding box as W S E N (lng/lat)")
    src.add_argument("--place", type=str, help='Place name, e.g. "San Francisco, California, USA"')
    ap.add_argument("--out", required=True, help="Output GeoJSON path, e.g. data/roads.geojson")
    args = ap.parse_args()

    if args.bbox:
        west, south, east, north = args.bbox
        G = graph_from_bbox_compat(north, south, east, west, network_type="drive")
    else:
        G = graph_from_place_compat(args.place, network_type="drive")

    # Convert to edges GeoDataFrame with geometries
    edges = ox.graph_to_gdfs(G, nodes=False, fill_edge_geometry=True)

    # Keep only line geometries and essential attributes
    edges = edges[edges.geometry.notnull()]
    edges = edges[edges.geom_type.isin(["LineString", "MultiLineString"])]

    # Normalize attributes expected by router
    if "highway" in edges.columns:
        edges["highway"] = edges["highway"].apply(_first).astype(str)
    else:
        edges["highway"] = ""

    if "oneway" in edges.columns:
        edges["oneway"] = edges["oneway"].apply(_norm_oneway)
    else:
        edges["oneway"] = ""

    if "maxspeed" in edges.columns:
        edges["maxspeed"] = edges["maxspeed"].apply(_first).astype(str)
    else:
        edges["maxspeed"] = ""

    out_cols = ["highway", "oneway", "maxspeed", "geometry"]
    edges = edges[out_cols]

    # Ensure CRS is WGS84 lon/lat
    if edges.crs is None:
        edges.set_crs(4326, inplace=True)
    else:
        edges = edges.to_crs(4326)

    # Write GeoJSON (avoid Fiona driver quirks by using GeoPandas directly)
    edges.to_file(args.out, driver="GeoJSON")
    print(f"Wrote {len(edges):,} edges to {args.out}")

if __name__ == "__main__":
    sys.exit(main())
