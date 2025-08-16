// src/lib/store.ts
"use client";

import { configureStore } from "@reduxjs/toolkit";
import reportsReducer from "../slices/reportsSlice";
import knowledgeReducer from "../slices/knowledgeSlice";
import modelReducer from "../slices/modelSlice";

export const store = configureStore({
  reducer: {
    reports: reportsReducer,
    knowledge: knowledgeReducer,
    model: modelReducer,
  },
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: false,
      immutableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
