// src/slices/modelSlice.ts
"use client";

import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ModelKind = "base" | "ensemble" | "fine";

export type ModelState = {
  kind: ModelKind;
  baseTag: string; // Ollama tag for base
  fineTag: string; // Ollama tag for your fine-tune (can be empty until ready)
};

const initialState: ModelState = {
  kind: "ensemble",
  baseTag: "gpt-oss:20b",
  fineTag: "terraguard-ft:20b", // change after training if different
};

const modelSlice = createSlice({
  name: "model",
  initialState,
  reducers: {
    setKind(state, action: PayloadAction<ModelKind>) {
      state.kind = action.payload;
    },
    setBaseTag(state, action: PayloadAction<string>) {
      state.baseTag = action.payload.trim();
    },
    setFineTag(state, action: PayloadAction<string>) {
      state.fineTag = action.payload.trim();
    },
  },
});

export const { setKind, setBaseTag, setFineTag } = modelSlice.actions;
export default modelSlice.reducer;
