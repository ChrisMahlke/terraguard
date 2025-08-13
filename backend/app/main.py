from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Tuple, Dict, Any, Optional
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from .llm import LLM
from . import tools
from .router_net import RoadRouter

app = FastAPI(title="TerraGuard API")
llm = LLM()
router = RoadRouter()  # reads data/roads.geojson

# ---------------------------
# Simple routing demo endpoint
# ---------------------------

class RouteRequest(BaseModel):
    start: Tuple[float, float]  # [lng, lat]
    end: Tuple[float, float]

class RouteResponse(BaseModel):
    path: List[Tuple[float, float]]
    distance_km: float

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/routes", response_model=RouteResponse)
def routes(req: RouteRequest):
    # Straight line for now (kept as a trivial baseline)
    (x1, y1), (x2, y2) = req.start, req.end
    path = [(x1 + (x2 - x1) * t / 20.0, y1 + (y2 - y1) * t / 20.0) for t in range(21)]
    # rough planar distance; replace with geodesic if needed
    dx, dy = x2 - x1, y2 - y1
    distance_km = ((dx * 111.32) ** 2 + (dy * 110.57) ** 2) ** 0.5
    return {"path": path, "distance_km": distance_km}

# ---------------------------
# JSON-structured planning API
# ---------------------------

class ReasonBody(BaseModel):
    prompt: str
    context: Optional[Dict[str, Any]] = None

class Phase(BaseModel):
    name: str
    eta_minutes: List[float] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)

class EvacRoute(BaseModel):
    purpose: str
    start: Optional[Tuple[float, float]] = None
    end: Optional[Tuple[float, float]] = None
    notes: Optional[str] = None

class Plan(BaseModel):
    summary: str
    phases: List[Phase] = Field(default_factory=list)
    evac_routes: List[EvacRoute] = Field(default_factory=list)
    resources: Dict[str, List[str]] = Field(default_factory=dict)
    communications: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    raw: Optional[str] = None  # used if the model returned non-JSON text

@app.post("/reason", response_model=Plan)
def reason(body: ReasonBody):
    plan = llm.generate_plan(body.prompt, body.context)

    # Hotfix: if an older llm.py returns a plain string, coerce to Plan shape
    if isinstance(plan, str):
        plan = {
            "summary": plan,
            "phases": [],
            "evac_routes": [],
            "resources": {},
            "communications": [],
            "risks": []
        }

    return Plan(**plan)

# ---------------------------
# Tool-calling "agent" API
# ---------------------------

class AgentBody(BaseModel):
    prompt: str
    context: Optional[Dict[str, Any]] = None  # may include bbox, start, end, geojson

class AgentToolCall(BaseModel):
    tool: str
    args: Dict[str, Any] = Field(default_factory=dict)

class AgentPlanPhase(BaseModel):
    name: str
    actions: List[str] = Field(default_factory=list)

class AgentPlan(BaseModel):
    summary: str
    phases: List[AgentPlanPhase] = Field(default_factory=list)

class AgentResponse(BaseModel):
    plan: AgentPlan
    tool_calls: List[AgentToolCall] = Field(default_factory=list)
    results: Dict[str, Any] = Field(default_factory=dict)

def _extract_first_polygon(fc_like) -> Optional[BaseGeometry]:
    """
    Accepts a FeatureCollection-like dict and returns the first Polygon/MultiPolygon as a shapely geometry.
    """
    if not isinstance(fc_like, dict):
        return None
    feats = fc_like.get("features") or []
    for f in feats:
        g = f.get("geometry")
        if not g:
            continue
        t = g.get("type")
        if t in ("Polygon", "MultiPolygon"):
            try:
                return shape(g)
            except Exception:
                continue
    return None

@app.post("/reason_agent", response_model=AgentResponse)
def reason_agent(body: AgentBody):
    draft = llm.propose_actions(body.prompt, body.context)
    plan = draft.get("plan", {})
    calls = draft.get("calls", [])

    # Fallback: if the model didn't request tools but we have start/end, ensure one routing call
    ctx = body.context or {}
    if not calls and ctx.get("start") and ctx.get("end"):
        calls.append({
            "tool": "route_between",
            "args": {"start": ctx["start"], "end": ctx["end"], "purpose": "primary"}
        })

    # Build hazard polygon from uploaded GeoJSON (first Polygon/MultiPolygon only)
    hazard_poly = None
    if "geojson" in ctx:
        hazard_poly = _extract_first_polygon(ctx["geojson"])

    results: Dict[str, Any] = {}
    for i, call in enumerate(calls):
        tool_name = call.get("tool")
        args = call.get("args", {})
        if tool_name == "route_between":
            start = tuple(args.get("start", []))
            end = tuple(args.get("end", []))
            if len(start) == 2 and len(end) == 2:
                # Use k-shortest routes with soft hazard penalties; fall back to straight/detour
                resk = router.route_k(
                    (start[0], start[1]),
                    (end[0], end[1]),
                    hazard=hazard_poly,
                    k=3,
                    hard_block_core=False
                )
                routes = resk.get("routes", []) or []
                if routes:
                    primary = dict(routes[0])
                    primary["mode"] = resk.get("mode")
                    primary["alternates"] = routes[1:]  # keep the remaining as alternates
                    if "purpose" in args:
                        primary["purpose"] = args["purpose"]
                    res = primary
                else:
                    # fallback: straight/detour
                    res = tools.route_between((start[0], start[1]), (end[0], end[1]), hazard=hazard_poly)
                    if "purpose" in args:
                        res["purpose"] = args["purpose"]

                results[f"route_{i}"] = res

    # Normalize for pydantic models
    norm_plan = {
        "summary": plan.get("summary", ""),
        "phases": [{"name": p.get("name", ""), "actions": p.get("actions", [])} for p in plan.get("phases", [])]
    }
    norm_calls = [{"tool": c.get("tool", ""), "args": c.get("args", {})} for c in calls]

    return {"plan": norm_plan, "tool_calls": norm_calls, "results": results}
