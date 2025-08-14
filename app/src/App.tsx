import { useEffect, useRef, useState } from "react";
import maplibregl, { MapLayerMouseEvent, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// --- Minimal GeoJSON types ---
type Geometry = { type: string; coordinates: any };
type Feature = { type: "Feature"; geometry: Geometry; properties?: any };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

// --- Styles ---
const ONLINE_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Simple offline style (no external tiles/glyphs)
const OFFLINE_STYLE: any = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#f7f8fb" } },
  ],
};

// Color palette for multiple hazards
const HAZARD_COLORS = [
  "#ff4d4f",
  "#fa8c16",
  "#faad14",
  "#13c2c2",
  "#2f54eb",
  "#722ed1",
];

// Sample hazard files you generated with scripts/make_hazards.py and copied to app/public/hazards/
const SAMPLE_HAZARDS = [
  { file: "sf_fire.geojson", label: "SF Fire Perimeter" },
  { file: "sf_flood.geojson", label: "SF Flood Zone" },
  { file: "sf_multi.geojson", label: "SF Multi-Polygon Demo" },
];

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startRef = useRef<[number, number] | null>(null);
  const endRef = useRef<[number, number] | null>(null);

  // Keep overlays so we can re-apply after style changes
  const currentRouteRef = useRef<[number, number][] | null>(null); // primary path
  const currentAltsRef = useRef<[number, number][][]>([]); // alternates
  const hazardsRef = useRef<FeatureCollection[]>([]); // multiple hazard FCs

  const [plan, setPlan] = useState<string>("");
  const [agentResp, setAgentResp] = useState<any>(null);
  const [offline, setOffline] = useState(false);
  const [hazardCount, setHazardCount] = useState(0);

  // Run drawing only after the style is fully ready. 'idle' is reliable after setStyle().
  const withMapReady = (fn: () => void) => {
    const map = mapRef.current!;
    if (map.isStyleLoaded()) fn();
    else map.once("idle", fn);
  };

  // ---------- drawing helpers ----------
  const drawPoint = (id: string, coord: [number, number]) => {
    withMapReady(() => {
      const map = mapRef.current!;
      const src = `${id}-src`,
        lyr = `${id}-lyr`;
      if (map.getLayer(lyr)) map.removeLayer(lyr);
      if (map.getSource(src)) map.removeSource(src);
      map.addSource(src, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: coord },
          properties: {},
        },
      });
      map.addLayer({
        id: lyr,
        type: "circle",
        source: src,
        paint: { "circle-radius": 6, "circle-color": "#2f54eb" },
      });
    });
  };

  const drawLine = (id: string, coords: [number, number][]) => {
    withMapReady(() => {
      const map = mapRef.current!;
      const src = `${id}-src`,
        lyr = `${id}-lyr`;
      if (map.getLayer(lyr)) map.removeLayer(lyr);
      if (map.getSource(src)) map.removeSource(src);
      map.addSource(src, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: lyr,
        type: "line",
        source: src,
        paint: { "line-width": 4 },
      });
    });
  };

  const drawDashedLine = (id: string, coords: [number, number][]) => {
    withMapReady(() => {
      const map = mapRef.current!;
      const src = `${id}-src`,
        lyr = `${id}-lyr`;
      if (map.getLayer(lyr)) map.removeLayer(lyr);
      if (map.getSource(src)) map.removeSource(src);
      map.addSource(src, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: lyr,
        type: "line",
        source: src,
        paint: { "line-width": 3, "line-dasharray": [2, 2] },
      });
    });
  };

  // Split a FeatureCollection into polys, lines, points
  const splitFC = (fc: FeatureCollection) => {
    const polys: Feature[] = [];
    const lines: Feature[] = [];
    const points: Feature[] = [];
    for (const f of fc.features || []) {
      const t = f?.geometry?.type;
      if (!t) continue;
      if (t === "Polygon" || t === "MultiPolygon") polys.push(f);
      else if (t === "LineString" || t === "MultiLineString") lines.push(f);
      else if (t === "Point" || t === "MultiPoint") points.push(f);
    }
    return {
      polys: {
        type: "FeatureCollection",
        features: polys,
      } as FeatureCollection,
      lines: {
        type: "FeatureCollection",
        features: lines,
      } as FeatureCollection,
      points: {
        type: "FeatureCollection",
        features: points,
      } as FeatureCollection,
    };
  };

  // Add one hazard FC with all shapes (fills, lines, points) under a unique id
  const addHazardLayers = (
    id: string,
    fc: FeatureCollection,
    color: string
  ) => {
    const { polys, lines, points } = splitFC(fc);
    withMapReady(() => {
      const map = mapRef.current!;

      // polygons (fill + outline)
      if (polys.features.length) {
        const src = `${id}-poly-src`;
        if (map.getLayer(`${id}-poly-fill`)) map.removeLayer(`${id}-poly-fill`);
        if (map.getLayer(`${id}-poly-outline`))
          map.removeLayer(`${id}-poly-outline`);
        if (map.getSource(src)) map.removeSource(src);
        map.addSource(src, { type: "geojson", data: polys });

        map.addLayer({
          id: `${id}-poly-fill`,
          type: "fill",
          source: src,
          paint: { "fill-color": color, "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: `${id}-poly-outline`,
          type: "line",
          source: src,
          paint: { "line-color": color, "line-width": 2 },
        });
      }

      // lines
      if (lines.features.length) {
        const src = `${id}-line-src`;
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
        if (map.getSource(src)) map.removeSource(src);
        map.addSource(src, { type: "geojson", data: lines });
        map.addLayer({
          id: `${id}-line`,
          type: "line",
          source: src,
          paint: {
            "line-color": color,
            "line-width": 3,
            "line-dasharray": [3, 2],
          },
        });
      }

      // points
      if (points.features.length) {
        const src = `${id}-pt-src`;
        if (map.getLayer(`${id}-pt`)) map.removeLayer(`${id}-pt`);
        if (map.getSource(src)) map.removeSource(src);
        map.addSource(src, { type: "geojson", data: points });
        map.addLayer({
          id: `${id}-pt`,
          type: "circle",
          source: src,
          paint: {
            "circle-radius": 5,
            "circle-color": color,
            "circle-stroke-color": "#222",
            "circle-stroke-width": 1,
          },
        });
      }
    });
  };

  const clearLayersByPrefix = (prefixes: string[]) => {
    withMapReady(() => {
      const map = mapRef.current!;
      const layers = map.getStyle().layers || [];
      for (const l of layers) {
        if (prefixes.some((p) => l.id.startsWith(p))) {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
        }
      }
      const sources = (map as any).style?._sources || {};
      Object.keys(sources).forEach((id) => {
        if (prefixes.some((p) => id.startsWith(p))) {
          if (map.getSource(id)) map.removeSource(id);
        }
      });
    });
  };

  const clearRoutes = () => {
    clearLayersByPrefix(["route", "alt_"]);
    currentRouteRef.current = null;
    currentAltsRef.current = [];
  };

  const clearHazards = () => {
    clearLayersByPrefix(["hazard_"]);
    hazardsRef.current = [];
    setHazardCount(0);
  };

  const labelDistanceOnMap = (coords: [number, number][], km: number) => {
    const map = mapRef.current!;
    if (!coords?.length) return;
    const mid = coords[Math.floor(coords.length / 2)];
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(mid)
      .setHTML(`${km.toFixed(2)} km`)
      .addTo(map);
  };

  // Re-apply overlays after style changes (offline toggle, etc.)
  const resetOverlays = () => {
    if (startRef.current) drawPoint("start", startRef.current);
    if (endRef.current) drawPoint("end", endRef.current);
    hazardsRef.current.forEach((fc, i) => {
      const color = HAZARD_COLORS[i % HAZARD_COLORS.length];
      addHazardLayers(`hazard_${i}`, fc, color);
    });
    if (currentRouteRef.current) drawLine("route", currentRouteRef.current);
    if (currentAltsRef.current?.length) {
      currentAltsRef.current.forEach((coords, i) =>
        drawDashedLine(`alt_${i}`, coords)
      );
    }
  };

  const toggleOffline = () => {
    const map = mapRef.current!;
    const next = !offline;
    setOffline(next);
    map.setStyle(next ? OFFLINE_STYLE : ONLINE_STYLE);
    map.once("idle", resetOverlays);
  };

  // ---------- quick geometry makers (no deps) ----------
  function circlePolygon(
    center: [number, number],
    radiusMeters = 600,
    steps = 64
  ): FeatureCollection {
    const [lng, lat] = center;
    const dLat = radiusMeters / 111320;
    const dLng = dLat / Math.cos((lat * Math.PI) / 180);
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      coords.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [coords] },
        },
      ],
    };
  }

  function rectanglePolygon(
    center: [number, number],
    wMeters = 900,
    hMeters = 600
  ): FeatureCollection {
    const [lng, lat] = center;
    const dLat = hMeters / 111320 / 2;
    const dLng = wMeters / 111320 / (2 * Math.cos((lat * Math.PI) / 180));
    const ring: [number, number][] = [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ];
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      ],
    };
  }

  const addDemoHazard = (shape: "circle" | "rect" = "circle") => {
    const map = mapRef.current!;
    const c = map.getCenter();
    const fc =
      shape === "circle"
        ? circlePolygon([c.lng, c.lat], 600)
        : rectanglePolygon([c.lng, c.lat], 900, 600);

    const nextIndex = hazardsRef.current.length;
    hazardsRef.current = [...hazardsRef.current, fc];
    setHazardCount(hazardsRef.current.length);
    const color = HAZARD_COLORS[nextIndex % HAZARD_COLORS.length];
    addHazardLayers(`hazard_${nextIndex}`, fc, color);
    fitToGeoJSON(fc);
  };

  const exportHazards = () => {
    const fc = buildHazardMultiPolygonFC();
    if (!fc) return alert("No hazard polygons to export.");
    const blob = new Blob([JSON.stringify(fc, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hazards_combined.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSampleHazard = async (name: string) => {
    if (!name) return;
    try {
      const r = await fetch(`/hazards/${name}`);
      if (!r.ok) return alert(`Couldn't load ${name}`);
      const fc = (await r.json()) as FeatureCollection;
      const nextIndex = hazardsRef.current.length;
      hazardsRef.current = [...hazardsRef.current, fc];
      setHazardCount(hazardsRef.current.length);
      const color = HAZARD_COLORS[nextIndex % HAZARD_COLORS.length];
      addHazardLayers(`hazard_${nextIndex}`, fc, color);
      fitToGeoJSON(fc);
    } catch {
      alert(`Failed to load ${name}`);
    }
  };

  // ---------- Map init, clicks, drag&drop ----------
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: offline ? OFFLINE_STYLE : ONLINE_STYLE,
      center: [-122.4194, 37.7749],
      zoom: 11,
    });
    mapRef.current = map;

    // demo marker on initial load
    map.once("load", () => {
      new maplibregl.Marker().setLngLat([-122.4194, 37.7749]).addTo(map);
    });

    // click to alternate placing Start/End
    let placing: "start" | "end" = "start";
    const onClick = (e: MapLayerMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (placing === "start") {
        startRef.current = pt;
        drawPoint("start", pt);
        placing = "end";
      } else {
        endRef.current = pt;
        drawPoint("end", pt);
        placing = "start";
      }
    };
    map.on("click", onClick);

    // drag & drop GeoJSON overlay(s) — supports multiple files dropped
    const el = containerRef.current;
    const prevent = (ev: DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onDrop = (ev: DragEvent) => {
      prevent(ev);
      const files = ev.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const addOne = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const fc = JSON.parse(String(reader.result)) as FeatureCollection;
            const nextIndex = hazardsRef.current.length;
            hazardsRef.current = [...hazardsRef.current, fc];
            setHazardCount(hazardsRef.current.length);
            const color = HAZARD_COLORS[nextIndex % HAZARD_COLORS.length];
            addHazardLayers(`hazard_${nextIndex}`, fc, color);
            fitToGeoJSON(fc);
          } catch {
            alert(`Invalid GeoJSON: ${file.name}`);
          }
        };
        reader.readAsText(file);
      };

      for (let i = 0; i < files.length; i++) addOne(files[i]);
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) =>
      el?.addEventListener(evt, prevent as any)
    );
    el?.addEventListener("drop", onDrop as any);

    return () => {
      map.off("click", onClick);
      ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) =>
        el?.removeEventListener(evt, prevent as any)
      );
      el?.removeEventListener("drop", onDrop as any);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // create the map once

  const fitToGeoJSON = (fc: FeatureCollection) => {
    const map = mapRef.current!;
    const pts: [number, number][] = [];
    for (const f of fc.features || []) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Point") pts.push(g.coordinates as any);
      if (g.type === "LineString") pts.push(...(g.coordinates as any));
      if (g.type === "Polygon") pts.push(...(g.coordinates as any).flat());
      if (g.type === "MultiLineString")
        pts.push(...(g.coordinates as any).flat());
      if (g.type === "MultiPolygon")
        pts.push(...(g.coordinates as any).flat(2));
    }
    if (!pts.length) return;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const bbox: LngLatBoundsLike = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
    map.fitBounds(bbox, { padding: 40 });
  };

  // Build a single MultiPolygon FeatureCollection from all hazard polygons
  const buildHazardMultiPolygonFC = (): FeatureCollection | null => {
    const allPolys: any[] = [];
    hazardsRef.current.forEach((fc) => {
      for (const f of fc.features || []) {
        const g = f?.geometry;
        if (!g) continue;
        if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
          allPolys.push(g.coordinates);
        } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
          for (const poly of g.coordinates) allPolys.push(poly);
        }
      }
    });
    if (!allPolys.length) return null;
    const multi: Feature = {
      type: "Feature",
      properties: { name: "combined_hazards" },
      geometry: { type: "MultiPolygon", coordinates: allPolys },
    };
    return { type: "FeatureCollection", features: [multi] };
  };

  // ---------- API calls ----------
  const getRoute = async () => {
    const s = startRef.current,
      e = endRef.current;
    if (!s || !e) return alert("Click map to set Start and End first.");
    clearRoutes();
    const r = await fetch("/api/routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: s, end: e }),
    });
    const j = await r.json();
    if (Array.isArray(j.path)) {
      drawLine("route", j.path);
      currentRouteRef.current = j.path;
      currentAltsRef.current = [];
      if (typeof j.distance_km === "number")
        labelDistanceOnMap(j.path, j.distance_km);
    }
  };

  const draftPlan = async () => {
    const map = mapRef.current!;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const hazardFC = buildHazardMultiPolygonFC();
    const r = await fetch("/api/reason", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Draft evacuation plan for current extent",
        context: {
          bbox,
          start: startRef.current,
          end: endRef.current,
          geojson: hazardFC,
        },
      }),
    });
    const j = await r.json();
    setPlan(JSON.stringify(j, null, 2));
  };

  const agentPlan = async () => {
    const map = mapRef.current!;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const hazardFC = buildHazardMultiPolygonFC();

    clearRoutes(); // ensure we don't stack old routes

    const r = await fetch("/api/reason_agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Agent plan for current extent",
        context: {
          bbox,
          start: startRef.current,
          end: endRef.current,
          geojson: hazardFC,
        },
      }),
    });
    const j = await r.json();

    // draw primary (prefer "route_0" if present)
    const primary =
      (j.results &&
        (j.results.route_0 || j.results.primary || j.results["route"])) ||
      null;
    if (primary && Array.isArray(primary.path)) {
      drawLine("route", primary.path);
      currentRouteRef.current = primary.path;
      if (typeof primary.distance_km === "number")
        labelDistanceOnMap(primary.path, primary.distance_km);
    }

    // draw alternates as dashed lines
    const alts = (primary?.alternates || []) as any[];
    currentAltsRef.current = [];
    alts.forEach((route: any, idx: number) => {
      if (Array.isArray(route?.path)) {
        drawDashedLine(`alt_${idx}`, route.path as [number, number][]);
        currentAltsRef.current.push(route.path as [number, number][]);
      }
    });

    setAgentResp(j);
  };

  // ---------- UI ----------
  return (
    <>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        className="panel"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "white",
          padding: 12,
          borderRadius: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,.1)",
          maxWidth: 780,
        }}
      >
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Click map to set <b>Start</b>, then <b>End</b>. You can drag & drop
          one or more <code>.geojson</code> files (Polygons, MultiPolygons,
          Lines, Points), or use the buttons below.
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button onClick={getRoute}>Get Demo Route (straight)</button>
          <button onClick={agentPlan}>Agent Plan</button>
          <button onClick={draftPlan}>Draft Plan (JSON)</button>
          <button onClick={toggleOffline}>
            {offline ? "Go Online Basemap" : "Go Offline Basemap"}
          </button>
          <button onClick={() => addDemoHazard("circle")}>
            Add Demo Hazard (circle)
          </button>
          <button onClick={() => addDemoHazard("rect")}>
            Add Demo Hazard (rectangle)
          </button>
          <select
            defaultValue=""
            onChange={(e) => loadSampleHazard(e.target.value)}
            title="Load a local sample hazard"
          >
            <option value="" disabled>
              Load Sample Hazard…
            </option>
            {SAMPLE_HAZARDS.map((s) => (
              <option key={s.file} value={s.file}>
                {s.label}
              </option>
            ))}
          </select>
          <button onClick={exportHazards}>Export Hazards</button>
          <button onClick={clearHazards} title="Remove all hazards">
            Clear Hazards ({hazardCount})
          </button>
        </div>

        {agentResp && (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            <div>
              <b>Summary:</b> {agentResp.plan?.summary || "(no summary)"}
            </div>
            {"route_0" in (agentResp.results || {}) && (
              <div style={{ marginTop: 4 }}>
                <b>Route distance:</b>{" "}
                {agentResp.results.route_0.distance_km?.toFixed(2)} km{" "}
                <b>ETA:</b> {agentResp.results.route_0.eta_min?.toFixed(1)} min
                {agentResp.results.route_0.avg_kph
                  ? ` (avg: ${agentResp.results.route_0.avg_kph.toFixed(
                      1
                    )} km/h)`
                  : ""}
                {agentResp.results.route_0.mode
                  ? ` [${agentResp.results.route_0.mode}]`
                  : ""}
              </div>
            )}
            {(agentResp.plan?.phases || []).length > 0 && (
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {agentResp.plan.phases.map((p: any, i: number) => (
                  <li key={i}>
                    <b>{p.name}:</b>{" "}
                    {Array.isArray(p.actions) ? p.actions.join("; ") : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {plan && (
          <pre
            style={{
              marginTop: 10,
              whiteSpace: "pre-wrap",
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            {plan}
          </pre>
        )}
      </div>
    </>
  );
}
