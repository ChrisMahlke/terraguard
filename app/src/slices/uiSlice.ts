// src/slices/uiSlice.ts
"use client";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type UIState = { center: [number, number]; zoom: number };
const initialState: UIState = { center: [-122.3321, 47.6062], zoom: 9 };

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setCenter(state, action: PayloadAction<[number, number]>) {
      state.center = action.payload;
    },
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = action.payload;
    },
  },
});

export const { setCenter, setZoom } = uiSlice.actions;
export default uiSlice.reducer;
