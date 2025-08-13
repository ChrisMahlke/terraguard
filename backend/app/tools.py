from typing import Tuple, List, Dict, Optional
import math
from shapely.geometry import LineString, Polygon

def _straight_line(start: Tuple[float, float], end: Tuple[float, float], n: int = 40) -> List[Tuple[float, float]]:
    (x1, y1), (x2, y2) = start, end
    return [(x1 + (x2 - x1) * t/n, y1 + (y2 - y1) * t/n) for t in range(n + 1)]

def _distance_km(start: Tuple[float, float], end: Tuple[float, float]) -> float:
    dx = (end[0] - start[0]) * 111.32
    dy = (end[1] - start[1]) * 110.57
    return math.hypot(dx, dy)

def _path_distance_km(path: List[Tuple[float, float]]) -> float:
    if len(path) < 2: return 0.0
    return sum(_distance_km(path[i], path[i+1]) for i in range(len(path)-1))

def _detour_polyline(start: Tuple[float, float], end: Tuple[float, float], poly: Polygon) -> List[Tuple[float, float]]:
    """
    Very simple detour: if the straight line intersects the polygon, route around the bbox
    using one of four 'dogleg' candidates and pick the shortest that doesn't intersect.
    """
    straight = LineString([start, end])
    if not straight.intersects(poly):
        return _straight_line(start, end)

    minx, miny, maxx, maxy = poly.bounds
    # pad detour by 10% bbox size (fallback to small constant if tiny)
    pad = max(maxx - minx, maxy - miny) * 0.1
    if pad == 0: pad = 0.01

    candidates = [
        [start, (minx - pad, start[1]), (minx - pad, end[1]), end],  # left around
        [start, (maxx + pad, start[1]), (maxx + pad, end[1]), end],  # right around
        [start, (start[0], miny - pad), (end[0], miny - pad), end],  # below
        [start, (start[0], maxy + pad), (end[0], maxy + pad), end],  # above
    ]

    best: Optional[List[Tuple[float, float]]] = None
    best_len = float("inf")

    for waypoints in candidates:
        # Discard if any segment crosses the polygon
        ok = True
        segs: List[Tuple[Tuple[float,float], Tuple[float,float]]] = list(zip(waypoints, waypoints[1:]))
        for (a, b) in segs:
            if LineString([a, b]).intersects(poly):
                ok = False
                break
        if not ok:
            continue

        # Densify for smoother drawing
        dense: List[Tuple[float, float]] = []
        for (a, b) in segs:
            dense.extend(_straight_line(a, b, n=15)[:-1])
        dense.append(waypoints[-1])

        total = _path_distance_km(dense)
        if total < best_len:
            best, best_len = dense, total

    # If all candidates intersect (rare), return straight (will intersect)
    return best or _straight_line(start, end)

def route_between(start: Tuple[float, float], end: Tuple[float, float], hazard: Optional[Polygon] = None) -> Dict:
    if hazard is None:
        path = _straight_line(start, end)
        return {"path": path, "distance_km": _path_distance_km(path), "avoided_hazard": False}

    path = _detour_polyline(start, end, hazard)
    return {"path": path, "distance_km": _path_distance_km(path), "avoided_hazard": True}
