// src/slices/reportsSlice.ts
"use client";

import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../lib/store";
import type { Facility } from "./knowledgeSlice";
import {
  computeRiskScore,
  suggestFacilities,
  normalizeNeeds,
} from "../lib/risk";

export type Report = {
  id: string;
  location_text: string | null;
  time_iso: string | null;
  severity: "low" | "moderate" | "high" | "critical" | null;
  needs: string[];
  notes?: string | null;
  dedupe_key?: string | null;

  // Annotations
  risk_score?: number; // 0..100
  suggestions?: Facility[];

  // Confidence (ensemble)
  confidence_overall?: number; // 0..1
  confields?: {
    location_text?: number; // 0..1
    time_iso?: number; // 0..1
    severity?: number; // 0..1
    needs?: number; // 0..1
  };
};

type ReportsState = {
  items: Report[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error?: string | null;
};

const initialState: ReportsState = {
  items: [],
  status: "idle",
  error: null,
};

export const extractReports = createAsyncThunk<
  { reports: Report[] },
  { text: string }
>("reports/extract", async ({ text }) => {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as { reports: Report[] };
});

// NEW: ensemble extraction with confidence
export const extractReportsEnsemble = createAsyncThunk<
  { reports: Report[] },
  { text: string; samples?: number }
>("reports/extractEnsemble", async ({ text, samples = 3 }) => {
  const res = await fetch("/api/extract/ensemble", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, samples }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as { reports: Report[] };
});

// Annotate with risk + suggestions using local knowledge
export const annotateReports = createAsyncThunk<
  { items: Report[] },
  void,
  { state: RootState }
>("reports/annotate", async (_arg, { getState }) => {
  const state = getState();
  const facilities = state.knowledge.facilities || [];
  const current = state.reports.items || [];

  const items = current.map((r) => {
    const normNeeds = normalizeNeeds(r.needs || []);
    const risk = computeRiskScore({
      severity: r.severity,
      needs: normNeeds,
      time_iso: r.time_iso,
    });
    const sugg = suggestFacilities(normNeeds, facilities, 3);
    return { ...r, needs: normNeeds, risk_score: risk, suggestions: sugg };
  });

  return { items };
});

const reportsSlice = createSlice({
  name: "reports",
  initialState,
  reducers: {
    clearReports(state) {
      state.items = [];
      state.status = "idle";
      state.error = null;
    },
    upsertReport(state, action: PayloadAction<Report>) {
      const idx = state.items.findIndex((r) => r.id === action.payload.id);
      if (idx >= 0) state.items[idx] = action.payload;
      else state.items.push(action.payload);
    },
    removeReport(state, action: PayloadAction<string>) {
      state.items = state.items.filter((r) => r.id !== action.payload);
    },
  },
  extraReducers(builder) {
    builder
      .addCase(extractReports.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(extractReports.fulfilled, (state, action) => {
        state.status = "succeeded";
        const incoming = action.payload.reports || [];
        const byId = new Map(state.items.map((r) => [r.id, r]));
        for (const r of incoming) byId.set(r.id, r);
        state.items = Array.from(byId.values());
      })
      .addCase(extractReports.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message || "Extraction failed";
      })

      .addCase(extractReportsEnsemble.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(extractReportsEnsemble.fulfilled, (state, action) => {
        state.status = "succeeded";
        const incoming = action.payload.reports || [];
        const byId = new Map(state.items.map((r) => [r.id, r]));
        for (const r of incoming) byId.set(r.id, r);
        state.items = Array.from(byId.values());
      })
      .addCase(extractReportsEnsemble.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message || "Ensemble extraction failed";
      })

      .addCase(annotateReports.fulfilled, (state, action) => {
        const updated = action.payload.items || [];
        const byId = new Map(state.items.map((r) => [r.id, r]));
        for (const r of updated) byId.set(r.id, r);
        state.items = Array.from(byId.values());
      });
  },
});

export const { clearReports, upsertReport, removeReport } =
  reportsSlice.actions;
export default reportsSlice.reducer;
