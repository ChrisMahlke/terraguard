// src/slices/knowledgeSlice.ts
"use client";

import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export type FacilityType =
  | "hospital"
  | "shelter"
  | "fire"
  | "police"
  | "public-works"
  | "utility";

export type Facility = {
  id: string;
  type: FacilityType;
  name: string;
  address?: string;
  phone?: string;
  notes?: string;
  capabilities?: string[]; // NEW: tags like "er","usar","pumps","pets"
};

type KnowledgeState = {
  facilities: Facility[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error?: string | null;
};

const initialState: KnowledgeState = {
  facilities: [],
  status: "idle",
  error: null,
};

export const loadKnowledge = createAsyncThunk<{ facilities: Facility[] }>(
  "knowledge/load",
  async () => {
    const res = await fetch("/data/facilities.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { facilities: Facility[] };
  }
);

const knowledgeSlice = createSlice({
  name: "knowledge",
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(loadKnowledge.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(loadKnowledge.fulfilled, (s, a) => {
        s.status = "succeeded";
        s.facilities = a.payload.facilities || [];
      })
      .addCase(loadKnowledge.rejected, (s, a) => {
        s.status = "failed";
        s.error = a.error.message || "failed";
      });
  },
});

export default knowledgeSlice.reducer;
