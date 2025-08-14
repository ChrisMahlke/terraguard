import { useEffect, useRef, useState } from "react";
import maplibregl, { MapLayerMouseEvent, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Minimal GeoJSON types to avoid extra deps
type FeatureCollection = { type: "FeatureCollection"; features: any[] };

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

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startRef = useRef<[number, number] | null>(null);
  const endRef = useRef<[number, number] | null>(null);

  // keep current overlays so we can re-apply after setStyle()
  const currentRouteRef = useRef<[number, number][] | null>(null); // primary path
  const currentAltsRef = useRef<[number, number][][]>([]); // alternates
  const currentHazardRef = useRef<FeatureCollection | null>(null); // uploaded GeoJSON

  const [plan, setPlan] = useState<string>("");
  const [agentResp, setAgentResp] = useState<any>(null);
  const [uploadedFc, setUploadedFc] = useState<FeatureCollection | null>(null);
  const [offline, setOffline] = useState(false);

  // Run drawing only after the style is fully ready. 'idle' works reliably after setStyle().
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

  const addOrReplaceGeoJSON = (id: string, fc: FeatureCollection) => {
    // Decide layer type: fill if any polygons, else line
    const hasPoly = fc.features?.some(
      (f: any) =>
        f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"
    );
    withMapReady(() => {
      const map = mapRef.current!;
      const src = `${id}-src`,
        lyr = `${id}-lyr`;
      if (map.getLayer(lyr)) map.removeLayer(lyr);
      if (map.getSource(src)) map.removeSource(src);
      map.addSource(src, { type: "geojson", data: fc });
      map.addLayer(
        hasPoly
          ? {
              id: lyr,
              type: "fill",
              source: src,
              paint: { "fill-color": "#ff4d4f", "fill-opacity": 0.25 },
            }
          : {
              id: lyr,
              type: "line",
              source: src,
              paint: { "line-width": 3 },
            }
      );
    });
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

  const clearLayersByPrefix = (prefixes: string[]) => {
    withMapReady(() => {
      const map = mapRef.current!;
      const layers = map.getStyle().layers || [];
      for (const l of layers) {
        if (prefixes.some((p) => l.id.startsWith(p))) {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
        }
      }
      // remove sources after layers
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

  // Re-apply overlays after style changes (offline toggle, etc.)
  const resetOverlays = () => {
    if (startRef.current) drawPoint("start", startRef.current);
    if (endRef.current) drawPoint("end", endRef.current);
    if (currentHazardRef.current)
      addOrReplaceGeoJSON("upload", currentHazardRef.current);
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

  // ---------- init map, clicks, drag&drop ----------
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

    // drag & drop GeoJSON overlay (hazard or lines)
    const el = containerRef.current;
    const prevent = (ev: DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onDrop = (ev: DragEvent) => {
      prevent(ev);
      const f = ev.dataTransfer?.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const fc = JSON.parse(String(reader.result)) as FeatureCollection;
          addOrReplaceGeoJSON("upload", fc);
          fitToGeoJSON(fc);
          setUploadedFc(fc);
          currentHazardRef.current = fc;
        } catch {
          alert("Invalid GeoJSON");
        }
      };
      reader.readAsText(f);
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

  // ---------- API calls ----------

  const draftPlan = async () => {
    const map = mapRef.current!;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const r = await fetch("/api/reason", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Draft evacuation plan for current extent",
        context: {
          bbox,
          start: startRef.current,
          end: endRef.current,
          geojson: uploadedFc,
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
    const context: any = {
      bbox,
      start: startRef.current,
      end: endRef.current,
      geojson: uploadedFc,
    };

    clearRoutes(); // ensure we don't stack old routes

    const r = await fetch("/api/reason_agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Agent plan for current extent",
        context,
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
          maxWidth: 520,
        }}
      >
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Click map to set <b>Start</b>, then <b>End</b>. Drag & drop a{" "}
          <code>.geojson</code> (e.g., hazard polygon) onto the map.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={agentPlan}>Agent Plan</button>
          <button onClick={draftPlan}>Draft Plan (JSON)</button>
          <button onClick={toggleOffline}>
            {offline ? "Go Online Basemap" : "Go Offline Basemap"}
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
