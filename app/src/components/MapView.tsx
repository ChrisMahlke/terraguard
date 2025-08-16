// src/components/MapView.tsx
"use client";

import { useEffect, useRef } from "react";
import maplibregl, { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";

const DEFAULT_CENTER: [number, number] = [-122.3321, 47.6062];
const DEFAULT_ZOOM = 9;

export default function MapView() {
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Minimal styles
  const fallbackStyle: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: "bg",
        type: "background",
        paint: { "background-color": "#0B0F14" },
      },
    ],
  };

  const buildPmtilesStyle = (pmtilesURL: string): StyleSpecification => {
    const full = layers("protomaps", namedFlavor("light"), { lang: "en" });
    const noSymbols = full.filter((l) => l.type !== "symbol"); // no labels/icons; keeps it glyph/sprite-free
    return {
      version: 8,
      sources: {
        protomaps: {
          type: "vector",
          url: `pmtiles://${pmtilesURL}`,
          attribution:
            '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
        } as any,
      },
      layers: noSymbols,
    };
  };

  useEffect(() => {
    // Register pmtiles protocol
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    // Start with a fallback style so the map always renders
    const map = new maplibregl.Map({
      container: "map",
      style: fallbackStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));

    // a11y
    const canvas = map.getCanvas();
    canvas.setAttribute("role", "region");
    canvas.setAttribute("aria-label", "Offline map area.");
    canvas.tabIndex = 0;

    mapRef.current = map;

    // If basemap exists, switch to it
    const pmtilesURL = new URL(
      "/assets/pmtiles/basemap.pmtiles",
      window.location.href
    ).toString();
    fetch(pmtilesURL, { method: "HEAD" })
      .then((res) => {
        if (res.ok) map.setStyle(buildPmtilesStyle(pmtilesURL));
      })
      .catch(() => {
        // keep fallback; optionally show a small hint
        const el = document.getElementById("map");
        if (el && !document.getElementById("map-hint")) {
          const div = document.createElement("div");
          div.id = "map-hint";
          Object.assign(div.style, {
            position: "absolute",
            bottom: "12px",
            left: "12px",
            padding: "8px 10px",
            background: "rgba(0,0,0,.6)",
            color: "white",
            borderRadius: "8px",
            font: "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          } as CSSStyleDeclaration);
          div.textContent =
            "No basemap found. Add public/assets/pmtiles/basemap.pmtiles";
          el.appendChild(div);
        }
      });

    return () => map.remove();
  }, []);

  return (
    <div
      id="map"
      style={{ position: "fixed", inset: 0, top: 64 }}
      aria-describedby="map-desc"
    >
      <span id="map-desc" className="sr-only">
        Offline basemap region.
      </span>
    </div>
  );
}
