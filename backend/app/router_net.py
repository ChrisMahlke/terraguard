from __future__ import annotations
from typing import Tuple, Dict, Any, List, Optional
import json, math
from itertools import islice
from numbers import Integral

import networkx as nx
from shapely.geometry import shape, LineString, Point, Polygon
from shapely.strtree import STRtree

LngLat = Tuple[float, float]

# Rough speeds (kph) by OSM highway class
SPEED_KPH = {
    "motorway": 100, "motorway_link": 80,
    "trunk": 80, "trunk_link": 70,
    "primary": 60, "primary_link": 50,
    "secondary": 50, "secondary_link": 45,
    "tertiary": 40, "tertiary_link": 35,
    "unclassified": 35, "residential": 30, "living_street": 15,
    "service": 20,
}

EDGE_PENALTY_HR = 0.0003  # ~18 seconds per edge to discourage zigzags

def _dist_km(a: LngLat, b: LngLat) -> float:
    dx = (b[0] - a[0]) * 111.32
    dy = (b[1] - a[1]) * 110.57
    return math.hypot(dx, dy)

def _poly_len_km(coords: List[LngLat]) -> float:
    if len(coords) < 2: return 0.0
    return sum(_dist_km(coords[i], coords[i+1]) for i in range(len(coords)-1))

def _speed_for(highway: Optional[str]) -> float:
    if not highway: return 30.0
    return float(SPEED_KPH.get(highway, 30.0))

def _oneway_dir(props: Dict[str, Any]) -> int:
    """
    Returns:  1 forward-only, -1 reverse-only, 0 bidirectional
    """
    ow = (props.get("oneway") or "").strip().lower()
    hwy = (props.get("highway") or "").strip().lower()
    junc = (props.get("junction") or "").strip().lower()
    if ow in ("yes", "true", "1"): return 1
    if ow in ("-1", "reverse"): return -1
    if junc == "roundabout": return 1
    if hwy == "motorway": return 1
    return 0

def _deg_for_km(km: float) -> float:
    return km / 111.32  # crude but fine at city scale

class RoadRouter:
    """
    Directed road router with:
      - one-way support (OSM 'oneway', 'junction=roundabout', 'motorway')
      - speed-aware weights (ETA in hours) + small per-edge penalty
      - hazard avoidance: soft penalties (halos) and optional hard block
      - snapping to nearest road edge (split edge at click)
      - k-shortest routes via NetworkX generator
    """
    def __init__(self, roads_fp: str = "data/roads.geojson"):
        self.roads_fp = roads_fp
        self._loaded = False

    # ---------- load graph ----------
    def _load(self):
        if self._loaded:
            return
        data = json.load(open(self.roads_fp))
        G = nx.DiGraph()

        seg_geoms: List[LineString] = []    # for STRtree (hazards/snapping)
        edge_geom: Dict[Tuple[LngLat, LngLat], List[LngLat]] = {}   # (u,v)->coords
        edge_attr: Dict[Tuple[LngLat, LngLat], Dict[str, Any]] = {} # (u,v)->attrs

        def add_directed(u: LngLat, v: LngLat, coords: List[LngLat], props: Dict[str, Any]):
            if u == v: return
            length_km = _poly_len_km(coords)
            speed = _speed_for(props.get("highway"))
            cost_hr = (length_km / max(speed, 1e-6)) + EDGE_PENALTY_HR
            G.add_edge(u, v, weight=cost_hr, length_km=length_km,
                       speed_kph=speed, highway=props.get("highway"))
            edge_geom[(u, v)] = coords
            edge_attr[(u, v)] = {"length_km": length_km, "speed_kph": speed, "highway": props.get("highway")}

        for f in data.get("features", []):
            g = f.get("geometry")
            if not g: continue
            props = f.get("properties") or {}
            geom = shape(g)
            def handle_coords(coords: List[LngLat]):
                ow = _oneway_dir(props)
                for i in range(len(coords) - 1):
                    a, b = coords[i], coords[i+1]
                    seg = LineString([a, b])
                    seg_geoms.append(seg)
                    if ow == 1:
                        add_directed(a, b, [a, b], props)
                    elif ow == -1:
                        add_directed(b, a, [b, a], props)
                    else:
                        add_directed(a, b, [a, b], props)
                        add_directed(b, a, [b, a], props)

            if geom.geom_type == "LineString":
                handle_coords(list(map(tuple, geom.coords)))
            elif geom.geom_type == "MultiLineString":
                for line in geom.geoms:
                    handle_coords(list(map(tuple, line.coords)))

        self.G = G
        self.seg_geoms = seg_geoms
        self.seg_index = STRtree(seg_geoms)
        self.edge_geom = edge_geom
        self.edge_attr = edge_attr
        self._loaded = True

    # ---------- snapping & hazard helpers ----------
    def _nearest_segment(self, p: LngLat) -> LineString:
        pt = Point(p)
        for r in (0.0001, 0.0003, 0.001, 0.003, 0.01):
            hits = self.seg_index.query(pt.buffer(r))
            idxs = hits.tolist() if hasattr(hits, "tolist") else list(hits)
            if len(idxs) == 0:
                continue
            geoms: List[LineString] = []
            for h in idxs:
                geoms.append(self.seg_geoms[int(h)] if isinstance(h, Integral) else h)
            if geoms:
                return min(geoms, key=lambda g: g.distance(pt))
        # fallback: global nearest
        return min(self.seg_geoms, key=lambda g: g.distance(pt))

    def _split_edge_in_graph(self, H: nx.DiGraph, edge_geom_map: Dict[Tuple[LngLat, LngLat], List[LngLat]],
                             seg: LineString, p: LngLat):
        a = tuple(seg.coords[0]); b = tuple(seg.coords[-1])
        pt = Point(p)
        d = seg.project(pt)
        qp = seg.interpolate(d)
        q = (qp.x, qp.y)

        had_ab = H.has_edge(a, b); data_ab = H.get_edge_data(a, b) if had_ab else None
        had_ba = H.has_edge(b, a); data_ba = H.get_edge_data(b, a) if had_ba else None

        if had_ab: H.remove_edge(a, b)
        if had_ba: H.remove_edge(b, a)

        def add_split(u: LngLat, v: LngLat, base_data: Dict[str, Any]):
            coords = [u, v]
            length_km = _poly_len_km(coords)
            speed = base_data.get("speed_kph", 30.0)
            cost_hr = (length_km / max(speed,1e-6)) + EDGE_PENALTY_HR
            H.add_edge(u, v, weight=cost_hr, length_km=length_km,
                       speed_kph=speed, highway=base_data.get("highway"))
            edge_geom_map[(u, v)] = coords

        if had_ab and data_ab:
            add_split(a, q, data_ab); add_split(q, b, data_ab)
        if had_ba and data_ba:
            add_split(b, q, data_ba); add_split(q, a, data_ba)
        return q

    def _apply_hazard_penalties(self, H: nx.DiGraph, edge_geom_map, hazard: Polygon, hard_block: bool=False):
        """
        Increase edge weights if they intersect a buffered hazard.
        hard_block=True removes edges that intersect the core hazard.
        """
        if hazard is None:
            return []
        removed = []
        core = hazard.buffer(_deg_for_km(0.0))
        near = hazard.buffer(_deg_for_km(0.1))   # ~100 m
        mid  = hazard.buffer(_deg_for_km(0.3))   # ~300 m

        for u, v, data in list(H.edges(data=True)):
            coords = edge_geom_map.get((u, v), [u, v])
            seg = LineString(coords)
            w = float(data.get("weight", 0.0))
            if seg.intersects(core):
                if hard_block:
                    H.remove_edge(u, v)
                    removed.append((u, v, data))
                    continue
                else:
                    w *= 10.0
            elif seg.intersects(near):
                w *= 3.0
            elif seg.intersects(mid):
                w *= 1.5
            data["weight"] = w
            H[u][v].update(data)
        return removed

    def _assemble_coords_and_metrics(self, H: nx.DiGraph, edge_geom_map, nodes: List[LngLat]):
        coords: List[LngLat] = []
        total_dist = 0.0
        total_cost_hr = 0.0
        for i in range(len(nodes)-1):
            u, v = nodes[i], nodes[i+1]
            seg_coords = edge_geom_map.get((u, v)) or [u, v]
            if not coords:
                coords.extend(seg_coords)
            else:
                coords.extend(seg_coords[1:] if coords[-1] == seg_coords[0] else seg_coords)
            data = H.get_edge_data(u, v) or {}
            total_dist += float(data.get("length_km", _poly_len_km(seg_coords)))
            total_cost_hr += float(data.get("weight", 0.0))
        return coords, total_dist, total_cost_hr

    # ---------- public API ----------
    def route(self, start: LngLat, end: LngLat, hazard: Optional[Polygon] = None) -> Dict[str, Any]:
        """Legacy single-route call (kept for compatibility)."""
        self._load()
        if self.G.number_of_nodes() == 0:
            return {"path": [], "distance_km": 0.0, "eta_min": 0.0, "mode": "network+directed"}

        H: nx.DiGraph = self.G.copy()
        edge_geom_map = dict(self.edge_geom)

        seg_s = self._nearest_segment(start)
        s_node = self._split_edge_in_graph(H, edge_geom_map, seg_s, start)
        seg_e = self._nearest_segment(end)
        e_node = self._split_edge_in_graph(H, edge_geom_map, seg_e, end)

        try:
            nodes = nx.shortest_path(H, s_node, e_node, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            nodes = []

        coords, dist_km, cost_hr = self._assemble_coords_and_metrics(H, edge_geom_map, nodes)
        return {"path": coords, "distance_km": dist_km, "eta_min": cost_hr * 60.0, "mode": "network+directed"}

    def route_k(self, start: LngLat, end: LngLat, hazard: Optional[Polygon]=None, k: int=3,
                hard_block_core: bool=False) -> Dict[str, Any]:
        """
        k best routes by ETA with soft hazard penalties (and optional hard block).
        Returns: {"routes":[{path, distance_km, eta_min}, ...], "mode": "..."}
        """
        self._load()
        if self.G.number_of_nodes() == 0:
            return {"routes": [], "mode": "network+directed+k"}

        H: nx.DiGraph = self.G.copy()
        edge_geom_map = dict(self.edge_geom)

        # Snap start/end to nearest edges and split
        seg_s = self._nearest_segment(start)
        s_node = self._split_edge_in_graph(H, edge_geom_map, seg_s, start)
        seg_e = self._nearest_segment(end)
        e_node = self._split_edge_in_graph(H, edge_geom_map, seg_e, end)

        # Apply hazard penalties (and optionally remove core-intersecting edges)
        removed = self._apply_hazard_penalties(H, edge_geom_map, hazard, hard_block=hard_block_core)

        routes_out = []
        try:
            gen = nx.shortest_simple_paths(H, s_node, e_node, weight="weight")
            for nodes in islice(gen, k):
                coords, dist_km, cost_hr = self._assemble_coords_and_metrics(H, edge_geom_map, nodes)
                routes_out.append({"path": coords, "distance_km": dist_km, "eta_min": cost_hr * 60.0})
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            pass

        # restore any removed edges
        for u, v, data in removed:
            H.add_edge(u, v, **data)

        return {"routes": routes_out, "mode": "network+directed+k"}
